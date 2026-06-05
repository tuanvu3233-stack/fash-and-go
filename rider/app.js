// Cấu hình bảng giá custom theo yêu cầu
const VEHICLE_PRICING = {
  bike: {
    saver: { name: "RideBike Tiết kiệm", basePrice: 12500, perKm: 4500, perMin: 150, icon: "🏍️", desc: "Xe máy tiết kiệm, nhanh chóng" },
    standard: { name: "RideBike Tiêu chuẩn", basePrice: 16000, perKm: 6000, perMin: 200, icon: "🛵", desc: "Xe ga rộng rãi hơn" }
  },
  car: {
    economy: { name: "RideCar Tiết kiệm", basePrice: 22000, perKm: 9000, perMin: 350, icon: "🚗", desc: "Xe 4 chỗ nhỏ gọn đi phố" },
    standard: { name: "RideCar 4 chỗ", basePrice: 26000, perKm: 11000, perMin: 450, icon: "🚙", desc: "Sedan thoải mái rộng rãi" },
    suv: { name: "RideCar 6 chỗ", basePrice: 32000, perKm: 13500, perMin: 550, icon: "🚐", desc: "Phù hợp nhóm đông người" }
  }
};

// Trạng thái cục bộ
let currentUser = null; // { userId, name, email_or_phone }
let selectedCategory = "bike"; // "bike" hoặc "car"
let selectedVehicle = null;
let activeDriverId = null;

const state = {
  pickup: null,
  destination: null,
  distance: 0,
  duration: 0,
  calculatedFares: [],
  routePolyline: null,
  pickupMarker: null,
  destinationMarker: null,
  driverMarker: null
};

let map;
let ws;
let selectedStarRating = 5;

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
      <a href="http://172.16.99.38:3000" style="color: #fff; text-decoration: underline; margin-left: 5px; font-weight: 800;">http://172.16.99.38:3000</a> 
      hoặc đổi sang máy chủ bảo mật (WSS) qua nút ⚙️.
    `;
    document.body.appendChild(warningDiv);
  }
}

// Kết nối WebSocket
function connectWebSocket() {
  const host = window.location.hostname;
  const savedWsUrl = localStorage.getItem("custom_ws_url");
  let defaultWsUrl = `ws://${host}:3001`;
  if (host.includes("vercel.app")) {
    defaultWsUrl = "wss://fash-and-go.onrender.com";
  }
  const wsUrl = savedWsUrl || defaultWsUrl;
  
  console.log(`[WS] Đang kết nối tới máy chủ: ${wsUrl}`);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[WS] Rider App kết nối mạng thành công.");
    const warningDiv = document.getElementById("ws-connection-warning");
    if (warningDiv) warningDiv.remove();
    if (currentUser) {
      registerRiderWS();
    }
  };

  ws.onerror = (err) => {
    console.error("[WS] Lỗi kết nối WebSocket:", err);
    showConnectionWarning();
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    // --- Đăng ký tài khoản thành công ---
    if (data.event === "signup_success") {
      alert("Đăng ký thành công! Vui lòng đăng nhập.");
      switchToLoginView();
    }
    
    // --- Đăng ký thất bại ---
    else if (data.event === "signup_error") {
      alert("Lỗi đăng ký: " + data.message);
    }
    
    // --- Đăng nhập thành công ---
    else if (data.event === "login_success") {
      currentUser = {
        userId: data.userId,
        name: data.name,
        email_or_phone: data.email_or_phone
      };
      
      // Hiển thị giao diện người dùng
      document.getElementById("auth-overlay").classList.add("hidden");
      document.getElementById("user-profile-card").classList.remove("hidden");
      document.getElementById("user-display-name").classList.remove("hidden");
      document.getElementById("user-display-name").innerText = "Xin chào, " + data.name + "!";
      document.getElementById("profile-name").innerText = data.name;
      document.getElementById("profile-contact").innerText = data.email_or_phone;
      
      registerRiderWS();
      
      if (!map) {
        initMap();
      }
    }
    
    // --- Đăng nhập thất bại ---
    else if (data.event === "login_error") {
      alert("Đăng nhập thất bại: " + data.message);
    }
    
    // --- Tài xế nhận cuốc xe ---
    else if (data.event === "ride_accepted") {
      activeDriverId = data.driverId;
      showSection("trip-section");
      document.getElementById("driver-name").innerText = data.driverName;
      document.getElementById("driver-car").innerText = data.carInfo;
      document.getElementById("driver-stars-val").innerText = data.stars ? parseFloat(data.stars).toFixed(1) : "5.0";
      
      document.getElementById("trip-status-banner").innerText = "Tài xế đang đến điểm đón";
      document.getElementById("trip-status-banner").style.backgroundColor = "var(--accent-primary)";
      
      updateDriverMarker(data.lat, data.lon);
    }
    
    // --- Tài xế cập nhật tọa độ GPS ---
    else if (data.event === "driver_location_update") {
      updateDriverMarker(data.lat, data.lon);
    }
    
    // --- Cập nhật trạng thái chuyến xe ---
    else if (data.event === "trip_status_update") {
      const banner = document.getElementById("trip-status-banner");
      if (data.status === "arrived") {
        banner.innerText = "Tài xế đã đến điểm đón! Vui lòng lên xe.";
        banner.style.backgroundColor = "#eab308";
      } else if (data.status === "started") {
        banner.innerText = "Chuyến đi đã bắt đầu! Chúc bạn di chuyển an toàn.";
        banner.style.backgroundColor = "#00b14f";
      } else if (data.status === "completed") {
        showSection("completed-section");
        document.getElementById("completed-fare").innerText = formatVND(selectedVehicle.price);
        if (state.driverMarker) {
          map.removeLayer(state.driverMarker);
          state.driverMarker = null;
        }
      }
    }
    
    // --- Tài xế hoặc khách hủy/ngắt kết nối ---
    else if (data.event === "rider_disconnected" || data.event === "ride_cancelled_by_system") {
      alert("Chuyến đi đã bị hủy.");
      resetToNewTrip();
    }
  };

  ws.onclose = () => {
    console.log("[WS] Mất kết nối. Đang thử kết nối lại sau 3 giây...");
    setTimeout(connectWebSocket, 3000);
  };
}

// Đăng ký kết nối WS sau đăng nhập
function registerRiderWS() {
  if (ws && ws.readyState === WebSocket.OPEN && currentUser) {
    ws.send(jsonStr({
      action: "register",
      id: currentUser.userId,
      role: "rider"
    }));
  }
}

// Khởi tạo Map
function initMap() {
  const defaultLatLng = [21.0285, 105.8542];
  map = L.map('map', { zoomControl: false }).setView(defaultLatLng, 13);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
}

// Cập nhật vị trí tài xế
function updateDriverMarker(lat, lon) {
  const latlng = [lat, lon];
  const carIcon = L.divIcon({
    className: 'custom-car-marker',
    html: `<div style="font-size: 24px; text-shadow: 0 0 5px rgba(0,0,0,0.5);">${selectedCategory === "bike" ? "🏍️" : "🚗"}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });

  if (state.driverMarker) {
    state.driverMarker.setLatLng(latlng);
  } else {
    state.driverMarker = L.marker(latlng, { icon: carIcon }).addTo(map);
  }

  if (state.pickup) {
    const dist = calculateDistance(lat, lon, state.pickup.lat, state.pickup.lon);
    document.getElementById("driver-distance").innerText = dist < 1 
      ? `${Math.round(dist * 1000)} m` 
      : `${dist.toFixed(1)} km`;
  }
}

// Chuyển đổi Xe máy / Ô tô
function switchVehicleCategory(category) {
  selectedCategory = category;
  document.getElementById("tab-2wheel").classList.toggle("active", category === "bike");
  document.getElementById("tab-4wheel").classList.toggle("active", category === "car");
  renderVehicleList();
}

// Tính cước theo bảng giá custom
function calculateFares() {
  state.calculatedFares = [];

  // 1. Xe máy (Bike)
  for (const [key, cfg] of Object.entries(VEHICLE_PRICING.bike)) {
    let price = cfg.basePrice;
    if (state.distance > 2) price += (state.distance - 2) * cfg.perKm;
    price += state.duration * cfg.perMin;
    state.calculatedFares.push({
      category: "bike", key, name: cfg.name, price: Math.round(price/1000)*1000, icon: cfg.icon, desc: cfg.desc
    });
  }

  // 2. Ô tô (Car)
  for (const [key, cfg] of Object.entries(VEHICLE_PRICING.car)) {
    let price = cfg.basePrice;
    if (state.distance > 2) price += (state.distance - 2) * cfg.perKm;
    price += state.duration * cfg.perMin;
    state.calculatedFares.push({
      category: "car", key, name: cfg.name, price: Math.round(price/1000)*1000, icon: cfg.icon, desc: cfg.desc
    });
  }

  document.getElementById("fare-estimate-box").classList.remove("hidden");
  renderVehicleList();
}

// Render danh sách phương tiện phù hợp danh mục đã chọn
function renderVehicleList() {
  const container = document.getElementById("vehicle-list");
  container.innerHTML = "";
  selectedVehicle = null;
  document.getElementById("book-btn").disabled = true;

  const list = state.calculatedFares.filter(v => v.category === selectedCategory);
  list.forEach(v => {
    const div = document.createElement("div");
    div.className = "vehicle-item";
    div.innerHTML = `
      <div class="vehicle-left">
        <span class="vehicle-icon">${v.icon}</span>
        <div>
          <div class="vehicle-name">${v.name}</div>
          <div class="vehicle-desc">${v.desc}</div>
        </div>
      </div>
      <div class="vehicle-price">${formatVND(v.price)}</div>
    `;

    div.addEventListener("click", () => {
      document.querySelectorAll(".vehicle-item").forEach(i => i.classList.remove("selected"));
      div.classList.add("selected");
      selectedVehicle = v;
      document.getElementById("book-btn").disabled = false;
    });

    container.appendChild(div);
  });
}

// Đặt Xe
document.getElementById("book-btn").addEventListener("click", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN || !selectedVehicle || !currentUser) return;

  showSection("searching-section");
  ws.send(jsonStr({
    action: "ride_request",
    id: currentUser.userId,
    riderName: currentUser.name,
    vehicle_type: selectedCategory, // "bike" hoặc "car"
    pickup: {
      lat: state.pickup.lat,
      lon: state.pickup.lon,
      label: state.pickup.label
    },
    destination: {
      lat: state.destination.lat,
      lon: state.destination.lon,
      label: state.destination.label
    },
    fare: formatVND(selectedVehicle.price)
  }));
});

// Setup gợi ý địa chỉ tìm kiếm
function setupAutocomplete(inputId, suggestionsId, stateKey, color) {
  const input = document.getElementById(inputId);
  const suggestionsList = document.getElementById(suggestionsId);
  const clearBtn = document.getElementById(`clear-${inputId.split("-")[0]}`);
  let debounceTimeout;

  input.addEventListener("input", () => {
    const query = input.value.trim();
    clearBtn.style.display = query.length > 0 ? "flex" : "none";

    if (query.length < 3) {
      suggestionsList.innerHTML = "";
      suggestionsList.classList.add("hidden");
      return;
    }

    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=vn&limit=5`)
        .then(res => res.json())
        .then(data => {
          suggestionsList.innerHTML = "";
          if (data.length === 0) return;

          data.forEach(item => {
            const div = document.createElement("div");
            div.className = "suggestion-item";
            div.innerHTML = `📍 <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${item.display_name}</span>`;
            div.addEventListener("click", () => {
              input.value = item.display_name;
              suggestionsList.innerHTML = "";
              suggestionsList.classList.add("hidden");
              
              state[stateKey] = {
                lat: parseFloat(item.lat),
                lon: parseFloat(item.lon),
                label: item.display_name
              };
              
              updateMapMarker(stateKey, color);
              calculateRoute();
            });
            suggestionsList.appendChild(div);
          });
          suggestionsList.classList.remove("hidden");
        });
    }, 450);
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.style.display = "none";
    suggestionsList.innerHTML = "";
    suggestionsList.classList.add("hidden");
    state[stateKey] = null;
    
    if (stateKey === "pickup" && state.pickupMarker) { map.removeLayer(state.pickupMarker); state.pickupMarker = null; }
    if (stateKey === "destination" && state.destinationMarker) { map.removeLayer(state.destinationMarker); state.destinationMarker = null; }
    if (state.routePolyline) { map.removeLayer(state.routePolyline); state.routePolyline = null; }
    
    document.getElementById("fare-estimate-box").classList.add("hidden");
  });
}

function updateMapMarker(stateKey, color) {
  const data = state[stateKey];
  if (!data) return;
  const latlng = [data.lat, data.lon];
  
  const markerIcon = L.divIcon({
    className: 'map-pin-icon',
    html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius:50%; border: 3px solid #fff; box-shadow: 0 0 8px rgba(0,0,0,0.3)"></div>`
  });

  if (stateKey === "pickup") {
    if (state.pickupMarker) state.pickupMarker.setLatLng(latlng);
    else state.pickupMarker = L.marker(latlng, { icon: markerIcon }).addTo(map);
  } else {
    if (state.destinationMarker) state.destinationMarker.setLatLng(latlng);
    else state.destinationMarker = L.marker(latlng, { icon: markerIcon }).addTo(map);
  }
  map.setView(latlng, 14);
}

function calculateRoute() {
  if (!state.pickup || !state.destination) return;
  const url = `https://router.project-osrm.org/route/v1/driving/${state.pickup.lon},${state.pickup.lat};${state.destination.lon},${state.destination.lat}?overview=full&geometries=geojson`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data.code !== "Ok" || !data.routes.length) return;
      const route = data.routes[0];
      state.distance = route.distance / 1000;
      state.duration = route.duration / 60;

      if (state.routePolyline) map.removeLayer(state.routePolyline);
      state.routePolyline = L.geoJSON(route.geometry, {
        style: { color: "var(--accent-primary)", weight: 5, opacity: 0.8 }
      }).addTo(map);

      map.fitBounds(state.routePolyline.getBounds(), { padding: [40, 40] });
      calculateFares();
    });
}

// Điều hướng biểu mẫu Đăng nhập/Đăng ký
const switchToSignup = document.getElementById("switch-to-signup");
const switchToLogin = document.getElementById("switch-to-login");
const loginBox = document.getElementById("login-form-box");
const signupBox = document.getElementById("signup-form-box");
const authTitle = document.getElementById("auth-title");

switchToSignup.addEventListener("click", () => {
  loginBox.classList.add("hidden");
  signupBox.classList.remove("hidden");
  authTitle.innerText = "Đăng Ký Fash And Go";
});

switchToLogin.addEventListener("click", () => {
  signupBox.classList.add("hidden");
  loginBox.classList.remove("hidden");
  authTitle.innerText = "Đăng Nhập Fash And Go";
});

function switchToLoginView() {
  signupBox.classList.add("hidden");
  loginBox.classList.remove("hidden");
  authTitle.innerText = "Đăng Nhập Fash And Go";
}

// Submit Đăng nhập
document.getElementById("submit-login-btn").addEventListener("click", () => {
  const acc = document.getElementById("login-account").value.trim();
  const pass = document.getElementById("login-password").value.trim();
  
  if (!acc || !pass) {
    alert("Vui lòng nhập đầy đủ thông tin.");
    return;
  }
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(jsonStr({
      action: "login",
      email_or_phone: acc,
      password: pass,
      role: "rider"
    }));
  }
});

// Submit Đăng ký
document.getElementById("submit-signup-btn").addEventListener("click", () => {
  const name = document.getElementById("signup-name").value.trim();
  const acc = document.getElementById("signup-account").value.trim();
  const pass = document.getElementById("signup-password").value.trim();
  
  if (!name || !acc || !pass) {
    alert("Vui lòng nhập đầy đủ thông tin.");
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(jsonStr({
      action: "signup",
      name: name,
      email_or_phone: acc,
      password: pass,
      role: "rider"
    }));
  }
});

// Submit Đánh giá sao tài xế
function setStar(num) {
  selectedStarRating = num;
  const stars = document.querySelectorAll("#stars-container span");
  stars.forEach((s, idx) => {
    s.style.opacity = idx < num ? "1" : "0.3";
  });
}

document.getElementById("new-trip-btn").addEventListener("click", () => {
  // Gửi số sao đã đánh giá lên Server trước khi reset
  if (ws && ws.readyState === WebSocket.OPEN && activeDriverId) {
    ws.send(jsonStr({
      action: "submit_rating",
      driverId: activeDriverId,
      stars: selectedStarRating
    }));
  }
  
  resetToNewTrip();
});

// Đăng xuất
document.getElementById("logout-btn").addEventListener("click", () => {
  currentUser = null;
  document.getElementById("auth-overlay").classList.remove("hidden");
  document.getElementById("user-profile-card").classList.add("hidden");
  document.getElementById("user-display-name").classList.add("hidden");
  
  document.getElementById("login-account").value = "";
  document.getElementById("login-password").value = "";
  
  resetToNewTrip();
});

// Hủy chuyến xe
document.getElementById("cancel-search-btn").addEventListener("click", resetToNewTrip);
document.getElementById("cancel-active-btn").addEventListener("click", () => {
  if (ws && ws.readyState === WebSocket.OPEN && activeDriverId) {
    ws.send(jsonStr({
      action: "driver_status_update",
      riderId: currentUser.userId,
      status: "cancelled"
    }));
  }
  resetToNewTrip();
});

function resetToNewTrip() {
  showSection("booking-section");
  activeDriverId = null;
  selectedStarRating = 5;
  setStar(5);
  
  if (state.driverMarker) {
    map.removeLayer(state.driverMarker);
    state.driverMarker = null;
  }
}

function showSection(sectionId) {
  document.getElementById("booking-section").classList.add("hidden");
  document.getElementById("searching-section").classList.add("hidden");
  document.getElementById("trip-section").classList.add("hidden");
  document.getElementById("completed-section").classList.add("hidden");
  
  document.getElementById(sectionId).classList.remove("hidden");
}

// Theme
document.getElementById("theme-toggle").addEventListener("click", () => {
  const curr = document.documentElement.getAttribute("data-theme");
  document.documentElement.setAttribute("data-theme", curr === "dark" ? "light" : "dark");
});

function formatVND(val) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);
}

function jsonStr(obj) { return JSON.stringify(obj); }

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

window.addEventListener("DOMContentLoaded", () => {
  setupAutocomplete("pickup-input", "pickup-suggestions", "pickup", "#00b14f");
  setupAutocomplete("destination-input", "destination-suggestions", "destination", "#ef4444");
  connectWebSocket();
  lucide.createIcons();

  // Nút cấu hình máy chủ WebSocket
  const settingsBtn = document.getElementById("settings-btn");
  const authSettingsBtn = document.getElementById("auth-settings-btn");
  
  const openSettings = () => {
    const host = window.location.hostname;
    let defaultWsUrl = `ws://${host}:3001`;
    if (host.includes("vercel.app")) {
      defaultWsUrl = "wss://fash-and-go.onrender.com";
    }
    const currentUrl = localStorage.getItem("custom_ws_url") || defaultWsUrl;
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
  };

  if (settingsBtn) settingsBtn.addEventListener("click", openSettings);
  if (authSettingsBtn) authSettingsBtn.addEventListener("click", openSettings);
});
