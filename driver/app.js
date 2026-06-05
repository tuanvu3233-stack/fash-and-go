// Trạng thái cục bộ của tài xế
let currentUser = null; // { userId, name, email_or_phone, stats: {...} }
let activeTrip = null; // { riderId, pickup, destination, fare, riderName }
let tripStage = "pickup"; // "pickup" -> "ride" -> "complete"
let routeCoordinates = [];
let currentCoordIndex = 0;
let simInterval = null;

const state = {
  currentLat: 21.0285 + (Math.random() - 0.5) * 0.02,
  currentLon: 105.8542 + (Math.random() - 0.5) * 0.02,
  isOnline: false,
  driverMarker: null
};

let map;
let ws;
let countdownTimer;

function showConnectionWarning() {
  let warningDiv = document.getElementById("ws-connection-warning");
  if (!warningDiv) {
    warningDiv = document.createElement("div");
    warningDiv.id = "ws-connection-warning";
    warningDiv.style.position = "fixed";
    warningDiv.style.top = "0";
    warningDiv.style.left = "0";
    warningDiv.style.width = "100%";
    warningDiv.style.backgroundColor = "#ef4444";
    warningDiv.style.color = "#fff";
    warningDiv.style.textAlign = "center";
    warningDiv.style.padding = "12px 16px";
    warningDiv.style.fontSize = "13px";
    warningDiv.style.fontWeight = "bold";
    warningDiv.style.zIndex = "99999";
    warningDiv.style.boxShadow = "0 4px 10px rgba(0,0,0,0.2)";
    warningDiv.innerHTML = `
      ⚠️ Không thể kết nối tới máy chủ! 
      Nếu dùng Vercel (HTTPS), hãy mở link IP cục bộ: 
      <a href="http://172.16.99.38:3002" style="color: #fff; text-decoration: underline; margin-left: 5px; font-weight: 800;">http://172.16.99.38:3002</a> 
      hoặc đổi sang máy chủ bảo mật (WSS) qua nút ⚙️.
    `;
    document.body.appendChild(warningDiv);
  }
}

// Kết nối WebSocket
function connectWebSocket() {
  const host = window.location.hostname;
  const savedWsUrl = localStorage.getItem("custom_ws_url");
  const wsUrl = savedWsUrl || `ws://${host}:3001`;
  
  console.log(`[WS] Driver App đang kết nối tới máy chủ: ${wsUrl}`);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[WS] Driver App kết nối mạng thành công.");
    const warningDiv = document.getElementById("ws-connection-warning");
    if (warningDiv) warningDiv.remove();
    if (currentUser) {
      registerDriverWS();
    }
  };

  ws.onerror = (err) => {
    console.error("[WS] Lỗi kết nối WebSocket:", err);
    showConnectionWarning();
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    // --- Đăng ký thành công ---
    if (data.event === "signup_success") {
      alert("Đăng ký đối tác thành công! Vui lòng đăng nhập.");
      switchToLoginView();
    }
    
    // --- Đăng ký thất bại ---
    else if (data.event === "signup_error") {
      alert("Lỗi đăng ký đối tác: " + data.message);
    }
    
    // --- Đăng nhập thành công ---
    else if (data.event === "login_success") {
      currentUser = {
        userId: data.userId,
        name: data.name,
        email_or_phone: data.email_or_phone,
        stats: data.stats
      };

      // Ẩn màn hình đăng nhập, mở bảng điều khiển tài xế
      document.getElementById("auth-overlay").classList.add("hidden");
      document.getElementById("status-card").classList.remove("hidden");
      document.getElementById("stats-dashboard-card").classList.remove("hidden");
      
      document.getElementById("driver-name-display").innerText = data.name;
      document.getElementById("driver-vehicle-display").innerText = `${data.stats.vehicle_name} • ${data.stats.license_plate}`;
      
      updateStatsUI(data.stats);
      registerDriverWS();
      
      if (!map) {
        initMap();
      }
    }
    
    // --- Đăng nhập thất bại ---
    else if (data.event === "login_error") {
      alert("Đăng nhập tài xế thất bại: " + data.message);
    }
    
    // --- Cập nhật chỉ số hiệu suất từ server ---
    else if (data.event === "stats_update") {
      if (currentUser) {
        currentUser.stats = data.stats;
        updateStatsUI(data.stats);
      }
    }
    
    // --- Nhận yêu cầu đặt xe mới ---
    else if (data.event === "new_ride_request") {
      if (!state.isOnline || activeTrip) return;
      
      // Kiểm tra loại phương tiện của khách yêu cầu có khớp với tài xế không
      if (currentUser && currentUser.stats.vehicle_type === data.vehicle_type) {
        showIncomingRequest(data);
      }
    }
    
    // --- Khách hàng hủy chuyến ---
    else if (data.event === "rider_disconnected") {
      alert("Khách hàng đã hủy chuyến xe này.");
      resetToIdle();
    }
  };

  ws.onclose = () => {
    console.log("[WS] Mất kết nối. Đang thử kết nối lại sau 3 giây...");
    setTimeout(connectWebSocket, 3000);
  };
}

function registerDriverWS() {
  if (ws && ws.readyState === WebSocket.OPEN && currentUser) {
    ws.send(jsonStr({
      action: "register",
      id: currentUser.userId,
      role: "driver"
    }));
  }
}

// Cập nhật giao diện Dashboard Chỉ số hoạt động
function updateStatsUI(stats) {
  if (!stats) return;
  document.getElementById("stat-income").innerText = formatVND(stats.today_income || 0);
  document.getElementById("stat-acceptance").innerText = `${stats.acceptance_rate}%`;
  document.getElementById("stat-cancel").innerText = `${stats.cancel_rate}%`;
  document.getElementById("stat-completion").innerText = `${stats.completion_rate}%`;
  document.getElementById("stat-stars").innerText = `${parseFloat(stats.stars).toFixed(1)} ⭐`;
}

// Khởi tạo Map
function initMap() {
  map = L.map('map', { zoomControl: false }).setView([state.currentLat, state.currentLon], 14);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  updateDriverMarkerOnMap();
}

function updateDriverMarkerOnMap() {
  const latlng = [state.currentLat, state.currentLon];
  const carIcon = L.divIcon({
    className: 'custom-driver-car-marker',
    html: `<div style="font-size: 26px; text-shadow: 0 0 5px rgba(0,0,0,0.5);">${currentUser && currentUser.stats.vehicle_type === 'bike' ? '🏍️' : '🚗'}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });

  if (state.driverMarker) {
    state.driverMarker.setLatLng(latlng);
  } else {
    state.driverMarker = L.marker(latlng, { icon: carIcon }).addTo(map);
  }
}

// Bật tắt trạng thái hoạt động online/offline
const statusToggle = document.getElementById("status-toggle");
const statusLabel = document.getElementById("status-label");

statusToggle.addEventListener("change", () => {
  state.isOnline = statusToggle.checked;
  statusLabel.innerText = state.isOnline ? "Trạng thái: Trực tuyến (Online)" : "Trạng thái: Ngoại tuyến (Offline)";
  
  if (ws && ws.readyState === WebSocket.OPEN && currentUser) {
    ws.send(jsonStr({
      action: "driver_status",
      status: state.isOnline ? "online" : "offline",
      lat: state.currentLat,
      lon: state.currentLon
    }));
  }
});

// Hiển thị cuộc gọi đặt xe
function showIncomingRequest(data) {
  activeTrip = data;
  document.getElementById("req-fare").innerText = data.fare;
  document.getElementById("req-rider").innerText = `Người đặt: ${data.riderName}`;
  document.getElementById("req-pickup").innerText = data.pickup.label;
  document.getElementById("req-dest").innerText = data.destination.label;
  
  document.getElementById("incoming-request-overlay").classList.remove("hidden");
  
  const progressBar = document.getElementById("progress-bar");
  progressBar.style.width = "100%";
  progressBar.style.transition = "none";
  
  setTimeout(() => {
    progressBar.style.width = "0%";
    progressBar.style.transition = "width 15s linear";
  }, 100);

  clearTimeout(countdownTimer);
  countdownTimer = setTimeout(() => {
    declineRequest();
  }, 15000);
}

// Từ chối cuộc gọi
document.getElementById("decline-request-btn").addEventListener("click", declineRequest);
function declineRequest() {
  clearTimeout(countdownTimer);
  document.getElementById("incoming-request-overlay").classList.add("hidden");
  
  // Gửi cập nhật giảm tỷ lệ nhận chuyến lên server (vì để trôi cuộc gọi)
  // Trong server.py, stats.trips_offered được tăng khi gửi yêu cầu, 
  // nếu từ chối, trips_accepted không tăng, tỷ lệ nhận tự giảm.
  activeTrip = null;
}

// Chấp nhận chuyến xe
document.getElementById("accept-request-btn").addEventListener("click", () => {
  clearTimeout(countdownTimer);
  document.getElementById("incoming-request-overlay").classList.add("hidden");
  
  if (!ws || ws.readyState !== WebSocket.OPEN || !activeTrip || !currentUser) return;

  ws.send(jsonStr({
    action: "ride_accept",
    riderId: activeTrip.riderId,
    lat: state.currentLat,
    lon: state.currentLon
  }));

  tripStage = "pickup";
  document.getElementById("active-trip-card").classList.remove("hidden");
  document.getElementById("status-card").classList.add("hidden");
  document.getElementById("stats-dashboard-card").classList.add("hidden");

  document.getElementById("trip-stage-text").innerText = "Đang đi đón khách";
  document.getElementById("rider-name-display").innerText = activeTrip.riderName;
  document.getElementById("trip-fare-display").innerText = activeTrip.fare;
  document.getElementById("pickup-label").innerText = activeTrip.pickup.label;
  document.getElementById("dest-label").innerText = activeTrip.destination.label;

  document.getElementById("action-btn").innerText = "Đã Đến Điểm Đón";

  // Lập lộ trình di chuyển tới chỗ khách
  fetchRoute(state.currentLat, state.currentLon, activeTrip.pickup.lat, activeTrip.pickup.lon);
});

// Tìm lộ trình và vẽ
let routePolyline = null;
function fetchRoute(startLat, startLon, endLat, endLon) {
  const url = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data.code !== "Ok" || !data.routes.length) return;
      const route = data.routes[0];
      routeCoordinates = route.geometry.coordinates.map(c => [c[1], c[0]]);
      currentCoordIndex = 0;

      if (routePolyline) map.removeLayer(routePolyline);
      routePolyline = L.geoJSON(route.geometry, {
        style: { color: "#00b1a9", weight: 5, opacity: 0.8 }
      }).addTo(map);

      map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });
    });
}

// Bấm nút cập nhật tiến độ
const actionBtn = document.getElementById("action-btn");
actionBtn.addEventListener("click", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN || !activeTrip || !currentUser) return;

  if (tripStage === "pickup") {
    tripStage = "ride";
    ws.send(jsonStr({
      action: "driver_status_update",
      riderId: activeTrip.riderId,
      status: "arrived"
    }));
    
    document.getElementById("trip-stage-text").innerText = "Tài xế đã đến điểm đón";
    actionBtn.innerText = "Bắt Đầu Chuyến Đi";
    
    fetchRoute(activeTrip.pickup.lat, activeTrip.pickup.lon, activeTrip.destination.lat, activeTrip.destination.lon);
  } 
  
  else if (tripStage === "ride") {
    tripStage = "complete";
    ws.send(jsonStr({
      action: "driver_status_update",
      riderId: activeTrip.riderId,
      status: "started"
    }));
    
    document.getElementById("trip-stage-text").innerText = "Chuyến đi đã bắt đầu";
    actionBtn.innerText = "Hoàn Thành Chuyến Đi";
  } 
  
  else if (tripStage === "complete") {
    // Chuyển đổi định dạng giá cước từ "50.000 đ" thành con số 50000 để server lưu
    const fareClean = activeTrip.fare.replace(/[^0-9]/g, "");
    
    ws.send(jsonStr({
      action: "driver_status_update",
      riderId: activeTrip.riderId,
      status: "completed",
      fare: fareClean
    }));
    
    state.currentLat = activeTrip.destination.lat;
    state.currentLon = activeTrip.destination.lon;
    updateDriverMarkerOnMap();
    
    alert("Chuyến đi hoàn thành!");
    resetToIdle();
  }
});

// Giả lập di chuyển
const simBtn = document.getElementById("sim-btn");
simBtn.addEventListener("click", () => {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
    simBtn.innerHTML = '<i data-lucide="play"></i> Giả lập xe di chuyển';
    lucide.createIcons();
    return;
  }

  if (routeCoordinates.length === 0) return;

  simBtn.innerHTML = '<i data-lucide="square"></i> Dừng giả lập';
  lucide.createIcons();

  simInterval = setInterval(() => {
    if (currentCoordIndex >= routeCoordinates.length) {
      clearInterval(simInterval);
      simInterval = null;
      simBtn.innerHTML = '<i data-lucide="play"></i> Giả lập xe di chuyển';
      lucide.createIcons();
      return;
    }

    const nextCoord = routeCoordinates[currentCoordIndex];
    state.currentLat = nextCoord[0];
    state.currentLon = nextCoord[1];
    
    updateDriverMarkerOnMap();
    map.setView(nextCoord);

    if (ws && ws.readyState === WebSocket.OPEN && activeTrip) {
      ws.send(jsonStr({
        action: "driver_location",
        riderId: activeTrip.riderId,
        lat: state.currentLat,
        lon: state.currentLon
      }));
    }

    currentCoordIndex++;
  }, 400);
});

// Hủy chuyến xe
document.getElementById("cancel-btn").addEventListener("click", () => {
  if (confirm("Bạn có chắc chắn muốn hủy chuyến xe này?")) {
    if (ws && ws.readyState === WebSocket.OPEN && activeTrip && currentUser) {
      ws.send(jsonStr({
        action: "driver_status_update",
        riderId: activeTrip.riderId,
        status: "cancelled"
      }));
    }
    resetToIdle();
  }
});

function resetToIdle() {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
  
  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }

  activeTrip = null;
  routeCoordinates = [];
  currentCoordIndex = 0;
  
  document.getElementById("active-trip-card").classList.add("hidden");
  document.getElementById("status-card").classList.remove("hidden");
  document.getElementById("stats-dashboard-card").classList.remove("hidden");
  
  statusToggle.checked = state.isOnline;
  simBtn.innerHTML = '<i data-lucide="play"></i> Giả lập xe di chuyển';
  lucide.createIcons();
}

// Chuyển đổi Đăng nhập / Đăng ký
const switchToSignup = document.getElementById("switch-to-signup");
const switchToLogin = document.getElementById("switch-to-login");
const loginBox = document.getElementById("login-form-box");
const signupBox = document.getElementById("signup-form-box");
const authTitle = document.getElementById("auth-title");

switchToSignup.addEventListener("click", () => {
  loginBox.classList.add("hidden");
  signupBox.classList.remove("hidden");
  authTitle.innerText = "Đăng Ký Đối Tác FAG";
});

switchToLogin.addEventListener("click", () => {
  signupBox.classList.add("hidden");
  loginBox.classList.remove("hidden");
  authTitle.innerText = "Đăng Nhập FAG Driver";
});

function switchToLoginView() {
  signupBox.classList.add("hidden");
  loginBox.classList.remove("hidden");
  authTitle.innerText = "Đăng Nhập FAG Driver";
}

// Đăng nhập
document.getElementById("submit-login-btn").addEventListener("click", () => {
  const acc = document.getElementById("login-account").value.trim();
  const pass = document.getElementById("login-password").value.trim();
  
  if (!acc || !pass) {
    alert("Vui lòng nhập đầy đủ tài khoản & mật khẩu.");
    return;
  }
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(jsonStr({
      action: "login",
      email_or_phone: acc,
      password: pass,
      role: "driver"
    }));
  }
});

// Đăng ký tài xế kèm phương tiện
document.getElementById("submit-signup-btn").addEventListener("click", () => {
  const name = document.getElementById("signup-name").value.trim();
  const acc = document.getElementById("signup-account").value.trim();
  const pass = document.getElementById("signup-password").value.trim();
  const vType = document.getElementById("signup-vehicle-type").value;
  const vName = document.getElementById("signup-vehicle-name").value.trim();
  const vPlate = document.getElementById("signup-license-plate").value.trim();
  
  if (!name || !acc || !pass || !vName || !vPlate) {
    alert("Vui lòng nhập đầy đủ tất cả thông tin phương tiện.");
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(jsonStr({
      action: "signup",
      name: name,
      email_or_phone: acc,
      password: pass,
      role: "driver",
      vehicle_type: vType,
      vehicle_name: vName,
      license_plate: vPlate
    }));
  }
});

// Đăng xuất
document.getElementById("logout-btn").addEventListener("click", () => {
  currentUser = null;
  document.getElementById("auth-overlay").classList.remove("hidden");
  document.getElementById("status-card").classList.add("hidden");
  document.getElementById("stats-dashboard-card").classList.add("hidden");
  
  document.getElementById("login-account").value = "";
  document.getElementById("login-password").value = "";
  
  resetToIdle();
});

// Theme
document.getElementById("theme-toggle").addEventListener("click", () => {
  const curr = document.documentElement.getAttribute("data-theme");
  document.documentElement.setAttribute("data-theme", curr === "dark" ? "light" : "dark");
});

function formatVND(val) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);
}

function jsonStr(obj) { return JSON.stringify(obj); }

window.addEventListener("DOMContentLoaded", () => {
  connectWebSocket();
  lucide.createIcons();

  // Nút cấu hình máy chủ WebSocket
  const settingsBtn = document.getElementById("settings-btn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      const host = window.location.hostname;
      const currentUrl = localStorage.getItem("custom_ws_url") || `ws://${host}:3001`;
      const newUrl = prompt("Cấu hình địa chỉ máy chủ Fash And Go:\n(Nhập ws:// hoặc wss:// kèm cổng, để trống để reset mặc định)", currentUrl);
      
      if (newUrl !== null) {
        const trimmed = newUrl.trim();
        if (trimmed) {
          localStorage.setItem("custom_ws_url", trimmed);
        } else {
          localStorage.removeItem("custom_ws_url");
        }
        alert("Đã lưu cấu hình server mới. Trang web sẽ tải lại.");
        window.location.reload();
      }
    });
  }
});
