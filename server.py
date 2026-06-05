import asyncio
import json
import websockets
from http.server import SimpleHTTPRequestHandler
from socketserver import TCPServer
import threading
import os
import sqlite3

# Cổng dịch vụ
RIDER_PORT = 3000
DRIVER_PORT = 3002
WS_PORT = int(os.environ.get("PORT", 3001))

# Danh sách kết nối trực tiếp thời gian thực
connected_riders = {}  # rider_id -> websocket
connected_drivers = {} # driver_id -> websocket
active_rides = {}      # rider_id -> driver_id

# ----------------- 1. KHỞI TẠO CƠ SỞ DỮ LIỆU SQLITE -----------------
def init_db():
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email_or_phone TEXT UNIQUE,
            password TEXT,
            name TEXT,
            role TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS driver_stats (
            user_id TEXT PRIMARY KEY,
            vehicle_type TEXT, -- "bike" hoặc "car"
            vehicle_name TEXT,
            license_plate TEXT,
            today_income REAL DEFAULT 0,
            trips_offered INTEGER DEFAULT 0,
            trips_accepted INTEGER DEFAULT 0,
            trips_cancelled INTEGER DEFAULT 0,
            trips_completed INTEGER DEFAULT 0,
            stars REAL DEFAULT 5.0,
            star_count INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS trips (
            id TEXT PRIMARY KEY,
            rider_id TEXT,
            driver_id TEXT,
            pickup_name TEXT,
            dest_name TEXT,
            fare REAL,
            status TEXT,
            stars_given INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()
    print("[SQLITE] Khởi tạo cơ sở dữ liệu thành công.")

init_db()

# Hàm lấy thông số tài xế
def get_driver_stats(driver_id):
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    cursor.execute('''
        SELECT vehicle_type, vehicle_name, license_plate, today_income, 
               trips_offered, trips_accepted, trips_cancelled, trips_completed, stars 
        FROM driver_stats WHERE user_id = ?
    ''', (driver_id,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        v_type, v_name, plate, income, offered, accepted, cancelled, completed, stars = row
        acc_rate = (accepted / offered * 100) if offered > 0 else 100.0
        can_rate = (cancelled / accepted * 100) if accepted > 0 else 0.0
        comp_rate = (completed / accepted * 100) if accepted > 0 else 100.0
        return {
            "vehicle_type": v_type,
            "vehicle_name": v_name,
            "license_plate": plate,
            "today_income": income,
            "acceptance_rate": round(acc_rate, 1),
            "cancel_rate": round(can_rate, 1),
            "completion_rate": round(comp_rate, 1),
            "stars": round(stars, 1)
        }
    return None

# ----------------- 2. WEB SERVER TĨNH (HTTP) -----------------
class CORSHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

def start_rider_server():
    TCPServer.allow_reuse_address = True
    handler = lambda *args, **kwargs: CORSHTTPRequestHandler(*args, directory='/Users/huqyo23.hm/Antigravity/rider', **kwargs)
    with TCPServer(("", RIDER_PORT), handler) as httpd:
        print(f"[HTTP] Rider App đang chạy tại http://localhost:{RIDER_PORT}/")
        httpd.serve_forever()

def start_driver_server():
    TCPServer.allow_reuse_address = True
    handler = lambda *args, **kwargs: CORSHTTPRequestHandler(*args, directory='/Users/huqyo23.hm/Antigravity/driver', **kwargs)
    with TCPServer(("", DRIVER_PORT), handler) as httpd:
        print(f"[HTTP] Driver App đang chạy tại http://localhost:{DRIVER_PORT}/")
        httpd.serve_forever()

# Chạy hai Web Server ở hai luồng độc lập (chỉ chạy khi ở local)
if "RENDER" not in os.environ:
    rider_thread = threading.Thread(target=start_rider_server, daemon=True)
    rider_thread.start()

    driver_thread = threading.Thread(target=start_driver_server, daemon=True)
    driver_thread.start()


# ----------------- 3. REAL-TIME SERVER (WEBSOCKET) -----------------
async def handler(websocket):
    client_id = None
    client_role = None
    
    try:
        async for message in websocket:
            data = json.loads(message)
            action = data.get("action")
            
            # --- Đăng ký tài khoản mới ---
            if action == "signup":
                email_or_phone = data.get("email_or_phone")
                password = data.get("password")
                name = data.get("name")
                role = data.get("role") # "rider" hoặc "driver"
                uid = "u_" + os.urandom(4).hex()
                
                try:
                    conn = sqlite3.connect('database.db')
                    cursor = conn.cursor()
                    cursor.execute('''
                        INSERT INTO users (id, email_or_phone, password, name, role) 
                        VALUES (?, ?, ?, ?, ?)
                    ''', (uid, email_or_phone, password, name, role))
                    
                    if role == "driver":
                        v_type = data.get("vehicle_type", "bike")
                        v_name = data.get("vehicle_name", "Xe máy tiêu chuẩn")
                        v_plate = data.get("license_plate", "29X-XXXX")
                        cursor.execute('''
                            INSERT INTO driver_stats (user_id, vehicle_type, vehicle_name, license_plate) 
                            VALUES (?, ?, ?, ?)
                        ''', (uid, v_type, v_name, v_plate))
                    
                    conn.commit()
                    conn.close()
                    await websocket.send(json.dumps({"event": "signup_success"}))
                except sqlite3.IntegrityError:
                    await websocket.send(json.dumps({"event": "signup_error", "message": "Email hoặc số điện thoại đã tồn tại."}))
                except Exception as e:
                    await websocket.send(json.dumps({"event": "signup_error", "message": str(e)}))

            # --- Đăng nhập tài khoản ---
            elif action == "login":
                email_or_phone = data.get("email_or_phone")
                password = data.get("password")
                
                conn = sqlite3.connect('database.db')
                cursor = conn.cursor()
                cursor.execute('SELECT id, password, name, role FROM users WHERE email_or_phone = ?', (email_or_phone,))
                row = cursor.fetchone()
                conn.close()
                
                if row and row[1] == password:
                    uid, _, name, role = row
                    client_id = uid
                    client_role = role
                    
                    response_payload = {
                        "event": "login_success",
                        "userId": uid,
                        "name": name,
                        "role": role,
                        "email_or_phone": email_or_phone
                    }
                    
                    if role == "driver":
                        stats = get_driver_stats(uid)
                        response_payload["stats"] = stats
                    
                    await websocket.send(json.dumps(response_payload))
                else:
                    await websocket.send(json.dumps({"event": "login_error", "message": "Sai tài khoản hoặc mật khẩu."}))

            # --- Kết nối thời gian thực sau khi đăng nhập ---
            elif action == "register":
                client_id = data.get("id")
                client_role = data.get("role")
                
                if client_role == "rider":
                    connected_riders[client_id] = websocket
                    print(f"[WS] Khách hàng trực tuyến: {client_id}")
                elif client_role == "driver":
                    connected_drivers[client_id] = {
                        "ws": websocket,
                        "status": "offline",
                        "lat": None,
                        "lon": None
                    }
                    print(f"[WS] Tài xế trực tuyến: {client_id}")

            # --- Tài xế cập nhật trạng thái hoạt động ---
            elif action == "driver_status":
                if client_id in connected_drivers:
                    connected_drivers[client_id]["status"] = data.get("status", "offline")
                    connected_drivers[client_id]["lat"] = data.get("lat")
                    connected_drivers[client_id]["lon"] = data.get("lon")
                    print(f"[WS] Tài xế {client_id} đổi trạng thái: {data.get('status')}")

            # --- Khách hàng gửi yêu cầu đặt xe ---
            elif action == "ride_request":
                # Tăng chỉ số 'trips_offered' (số chuyến được mời) cho tất cả tài xế đang online phù hợp loại xe
                # Nhưng để tránh tăng vô tội vạ, ta chỉ tăng khi phát sóng chuyến
                req_vehicle_type = data.get("vehicle_type", "bike") # "bike" hoặc "car"
                
                conn = sqlite3.connect('database.db')
                cursor = conn.cursor()
                
                request_payload = {
                    "event": "new_ride_request",
                    "riderId": client_id,
                    "riderName": data.get("riderName", "Khách hàng"),
                    "pickup": data.get("pickup"),
                    "destination": data.get("destination"),
                    "fare": data.get("fare"),
                    "vehicle_type": req_vehicle_type
                }
                
                drivers_notified = 0
                for drv_id, drv_info in list(connected_drivers.items()):
                    if drv_info["status"] == "online":
                        # Truy vấn loại xe của tài xế
                        cursor.execute('SELECT vehicle_type FROM driver_stats WHERE user_id = ?', (drv_id,))
                        drv_v_row = cursor.fetchone()
                        if drv_v_row and drv_v_row[0] == req_vehicle_type:
                            try:
                                # Tăng số lần nhận được cuộc gọi chuyến
                                cursor.execute('UPDATE driver_stats SET trips_offered = trips_offered + 1 WHERE user_id = ?', (drv_id,))
                                await drv_info["ws"].send(json.dumps(request_payload))
                                
                                # Gửi cập nhật thông số tỷ lệ nhận mới ngay lập tức
                                updated_stats = get_driver_stats(drv_id)
                                await drv_info["ws"].send(json.dumps({
                                    "event": "stats_update",
                                    "stats": updated_stats
                                }))
                                
                                drivers_notified += 1
                            except Exception as e:
                                print(f"[WS] Lỗi gửi yêu cầu tới Driver {drv_id}: {e}")
                
                conn.commit()
                conn.close()
                print(f"[WS] Đã phát sóng yêu cầu xe {req_vehicle_type} cho {drivers_notified} tài xế.")

            # --- Tài xế chấp nhận chuyến đi ---
            elif action == "ride_accept":
                rider_id = data.get("riderId")
                driver_id = client_id
                
                # Tăng trips_accepted
                conn = sqlite3.connect('database.db')
                cursor = conn.cursor()
                cursor.execute('UPDATE driver_stats SET trips_accepted = trips_accepted + 1 WHERE user_id = ?', (driver_id,))
                
                # Truy vấn thông tin tài xế và xe
                cursor.execute('SELECT name FROM users WHERE id = ?', (driver_id,))
                d_name_row = cursor.fetchone()
                d_name = d_name_row[0] if d_name_row else "Tài xế"
                
                cursor.execute('SELECT vehicle_name, license_plate FROM driver_stats WHERE user_id = ?', (driver_id,))
                v_row = cursor.fetchone()
                car_info = f"{v_row[0]} • {v_row[1]}" if v_row else "Xe di động"
                
                conn.commit()
                conn.close()

                if rider_id in connected_riders:
                    active_rides[rider_id] = driver_id
                    if driver_id in connected_drivers:
                        connected_drivers[driver_id]["status"] = "busy"
                    
                    accept_payload = {
                        "event": "ride_accepted",
                        "driverId": driver_id,
                        "driverName": d_name,
                        "carInfo": car_info,
                        "lat": data.get("lat"),
                        "lon": data.get("lon")
                    }
                    await connected_riders[rider_id].send(json.dumps(accept_payload))
                
                # Gửi thông số cập nhật cho tài xế
                updated_stats = get_driver_stats(driver_id)
                await websocket.send(json.dumps({
                    "event": "stats_update",
                    "stats": updated_stats
                }))

            # --- Tài xế cập nhật vị trí di chuyển ---
            elif action == "driver_location":
                rider_id = data.get("riderId")
                if rider_id in connected_riders:
                    location_payload = {
                        "event": "driver_location_update",
                        "lat": data.get("lat"),
                        "lon": data.get("lon")
                    }
                    try:
                        await connected_riders[rider_id].send(json.dumps(location_payload))
                    except:
                        pass

            # --- Cập nhật trạng thái chuyến đi ---
            elif action == "driver_status_update":
                rider_id = data.get("riderId")
                status = data.get("status")
                driver_id = client_id
                
                if rider_id in connected_riders:
                    await connected_riders[rider_id].send(json.dumps({
                        "event": "trip_status_update",
                        "status": status
                    }))
                
                # Nếu hủy chuyến từ phía tài xế
                if status == "cancelled":
                    conn = sqlite3.connect('database.db')
                    cursor = conn.cursor()
                    cursor.execute('UPDATE driver_stats SET trips_cancelled = trips_cancelled + 1 WHERE user_id = ?', (driver_id,))
                    conn.commit()
                    conn.close()
                    
                    if driver_id in connected_drivers:
                        connected_drivers[driver_id]["status"] = "online"
                    if rider_id in active_rides:
                        del active_rides[rider_id]
                        
                    # Cập nhật số liệu gửi về tài xế
                    updated_stats = get_driver_stats(driver_id)
                    await websocket.send(json.dumps({
                        "event": "stats_update",
                        "stats": updated_stats
                    }))

                # Nếu hoàn thành chuyến đi
                elif status == "completed":
                    fare_val = float(data.get("fare", 0))
                    conn = sqlite3.connect('database.db')
                    cursor = conn.cursor()
                    cursor.execute('''
                        UPDATE driver_stats 
                        SET trips_completed = trips_completed + 1,
                            today_income = today_income + ? 
                        WHERE user_id = ?
                    ''', (fare_val, driver_id))
                    conn.commit()
                    conn.close()
                    
                    if driver_id in connected_drivers:
                        connected_drivers[driver_id]["status"] = "online"
                    if rider_id in active_rides:
                        del active_rides[rider_id]
                        
                    # Cập nhật số liệu gửi về tài xế
                    updated_stats = get_driver_stats(driver_id)
                    await websocket.send(json.dumps({
                        "event": "stats_update",
                        "stats": updated_stats
                    }))

            # --- Khách hàng đánh giá sao tài xế ---
            elif action == "submit_rating":
                driver_id = data.get("driverId")
                stars = int(data.get("stars", 5))
                
                conn = sqlite3.connect('database.db')
                cursor = conn.cursor()
                
                # Truy vấn số lượng sao cũ để tính trung bình cộng tích lũy
                cursor.execute('SELECT stars, star_count FROM driver_stats WHERE user_id = ?', (driver_id,))
                row = cursor.fetchone()
                if row:
                    curr_stars, curr_count = row
                    new_count = curr_count + 1
                    new_stars = ((curr_stars * curr_count) + stars) / new_count
                    cursor.execute('UPDATE driver_stats SET stars = ?, star_count = ? WHERE user_id = ?', (new_stars, new_count, driver_id))
                
                conn.commit()
                conn.close()
                
                # Gửi thông số cập nhật cho tài xế nếu tài xế đang online
                if driver_id in connected_drivers:
                    updated_stats = get_driver_stats(driver_id)
                    try:
                        await connected_drivers[driver_id]["ws"].send(json.dumps({
                            "event": "stats_update",
                            "stats": updated_stats
                        }))
                    except:
                        pass

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        # Dọn dẹp kết nối khi thoát
        if client_role == "rider" and client_id in connected_riders:
            del connected_riders[client_id]
            for rid, did in list(active_rides.items()):
                if rid == client_id:
                    if did in connected_drivers:
                        try:
                            # Nếu khách ngắt kết nối đột ngột, tài xế trở lại online
                            conn = sqlite3.connect('database.db')
                            cursor = conn.cursor()
                            cursor.execute('UPDATE driver_stats SET trips_cancelled = trips_cancelled + 1 WHERE user_id = ?', (did,))
                            conn.commit()
                            conn.close()
                            
                            await connected_drivers[did]["ws"].send(json.dumps({"event": "rider_disconnected"}))
                            connected_drivers[did]["status"] = "online"
                            
                            updated_stats = get_driver_stats(did)
                            await connected_drivers[did]["ws"].send(json.dumps({
                                "event": "stats_update",
                                "stats": updated_stats
                            }))
                        except:
                            pass
                    del active_rides[rid]
        elif client_role == "driver" and client_id in connected_drivers:
            del connected_drivers[client_id]

async def start_ws_server():
    print(f"[WS] Đang chạy WebSocket Server trên cổng {WS_PORT}...")
    async with websockets.serve(handler, "0.0.0.0", WS_PORT):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(start_ws_server())
    except KeyboardInterrupt:
        print("\n[MÁY CHỦ] Đã dừng hoạt động.")
