<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>3D Fight Game</title>
  <style>
    body { margin: 0; overflow: hidden; }
    #ui {
      position: absolute;
      top: 10px;
      left: 10px;
      color: white;
      font-family: Arial;
    }
    button { padding: 10px; margin: 5px; }
  </style>
</head>
<body>

<div id="ui">
  <div>❤️ Bạn: <span id="pHP">100</span></div>
  <div>💀 Máy: <span id="eHP">100</span></div>
  <button onclick="attack()">👊 Đánh</button>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>

<script>
let scene = new THREE.Scene();
let camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
let renderer = new THREE.WebGLRenderer();

renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Ánh sáng
let light = new THREE.PointLight(0xffffff, 1);
light.position.set(10,10,10);
scene.add(light);

// Player (xanh)
let player = new THREE.Mesh(
  new THREE.BoxGeometry(),
  new THREE.MeshStandardMaterial({color: "blue"})
);
player.position.x = -2;
scene.add(player);

// Enemy (đỏ)
let enemy = new THREE.Mesh(
  new THREE.BoxGeometry(),
  new THREE.MeshStandardMaterial({color: "red"})
);
enemy.position.x = 2;
scene.add(enemy);

camera.position.z = 5;

// HP
let playerHP = 100;
let enemyHP = 100;

function updateUI(){
  document.getElementById("pHP").innerText = playerHP;
  document.getElementById("eHP").innerText = enemyHP;
}

// Animation
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

// Attack
function attack(){
  let dmg = Math.floor(Math.random()*20)+5;
  enemyHP -= dmg;

  enemy.position.x += 0.5;
  setTimeout(()=> enemy.position.x = 2, 100);

  if(enemyHP <= 0){
    alert("🎉 Bạn thắng!");
    reset();
    return;
  }

  enemyAttack();
  updateUI();
}

function enemyAttack(){
  let dmg = Math.floor(Math.random()*15)+5;
  playerHP -= dmg;

  player.position.x -= 0.5;
  setTimeout(()=> player.position.x = -2, 100);

  if(playerHP <= 0){
    alert("💀 Bạn thua!");
    reset();
  }
}

function reset(){
  playerHP = 100;
  enemyHP = 100;
  updateUI();
}

updateUI();
</script>

</body>
</html>