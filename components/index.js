if (typeof AFRAME === 'undefined') {
  throw new Error('Component attempted to register before AFRAME was available.');
}

let score = 0;
let health = 3;


AFRAME.registerComponent('in-vr', {
  init: function(){
    var vr = document.getElementById('scene');
    var leftLaserGun = document.getElementById("left_laser").object3D;
    var rightLaserGun = document.getElementById("right_laser").object3D;
    var fpsLaserGun = document.getElementById("fps_laser").object3D;
    var scoreTitle = document.getElementById("score_display");
    var healthTitle = document.getElementById("health_display");
    vr.addEventListener('enter-vr', function() {
      healthTitle.setAttribute('position','-0.75 0.85 -1');
      scoreTitle.setAttribute('position','-0.75 0.95 -1');
      fpsLaserGun.visible = false;
      leftLaserGun.visible = true;
      rightLaserGun.visible = true;
    })
    vr.addEventListener('exit-vr', function() {
      healthTitle.setAttribute('position','-0.75 0.7 -1');
      scoreTitle.setAttribute('position','-0.75 0.8 -1');
      fpsLaserGun.visible = true;
      leftLaserGun.visible = false;
      rightLaserGun.visible = false;
    })
  }
});

AFRAME.registerComponent('resize-text', {
  init: function() {  
    var self = this;
    window.addEventListener('resize', function(e) {
      var width = window.innerWidth;      
      self.el.setAttribute('width', ( width / 600 ));
    });
  }
});

AFRAME.registerComponent('click-to-shoot', {
  init: function () {
    document.body.addEventListener('keydown', (key) => { 
      if(key.code == "Space"){
        this.el.emit('shoot'); 
      }
    });
  }
});

/**
 * Shooter. Entity that spawns bullets and handles bullet types.
 */
AFRAME.registerComponent('shooter', {
  schema: {
    activeBulletType: {type: 'string', default: 'normal'},
    bulletTypes: {type: 'array', default: ['normal']},
    cycle: {default: false}
  },

  init: function () {
    this.el.addEventListener('shoot', this.onShoot.bind(this));
    this.el.addEventListener('changebullet', this.onChangeBullet.bind(this));
    this.bulletSystem = this.el.sceneEl.systems.bullet;
  },

  /**
   * Listent to `shoot` action / event to tell bullet system to fire a bullet.
   */
  onShoot: function () {
    this.bulletSystem.shoot(this.data.activeBulletType, this.el.object3D);
  },

  /**
   * Listen to `changebullet` action / event telling the shooter to change bullet type.
   */
  onChangeBullet: function (evt) {
    var data = this.data;
    var el = this.el;
    var idx;

    // Cycle to next bullet type.
    if (evt.detail === 'next') {
      idx = data.bulletTypes.indexOf(data.activeBulletType);
      if (idx === -1) { return; }
      idx = data.cycle
        ? (idx + 1) % data.bulletTypes.length
        : Math.min(data.bulletTypes.length - 1, idx + 1);
      data.activeBulletType = data.bulletTypes[idx];
      el.setAttribute('shooter', 'activeBulletType', data.bulletTypes[idx]);
      return;
    }

    // Cycle to previous bullet type.
    if (evt.detail === 'prev') {
      idx = data.bulletTypes.indexOf(data.activeBulletType);
      if (idx === -1) { return; }
      idx = data.cycle
        ? (idx - 1) % data.bulletTypes.length
        : Math.max(0, idx - 1);
      data.activeBulletType = data.bulletTypes[idx];
      el.setAttribute('shooter', 'activeBulletType', data.bulletTypes[idx]);
      return;
    }

    // Direct set bullet type.
    el.setAttribute('shooter', 'activeBulletType', evt.detail);
  }
});

/**
 * Bullet system for collision detection.
 */
AFRAME.registerSystem('bullet', {
  init: function () {
    var bulletContainer;
    bulletContainer = document.createElement('a-entity');
    bulletContainer.id = 'BulletContainer';
    this.el.sceneEl.appendChild(bulletContainer);

    this.container = bulletContainer.object3D;
    this.pool = {};
    this.targets = [];
  },

  /**
   * Register and initialize bullet type.
   */
  registerBullet: function (bulletComponent) {
    var bullet;
    var bulletData;
    var i;
    var model;

    model = bulletComponent.el.object3D;
    if (!model) { return; }
    bulletData = bulletComponent.data;

    // Initialize pool and bullets.
    this.pool[bulletData.name] = [];
    for (i = 0; i < bulletData.poolSize; i++) {
      bullet = model.clone();
      bullet.damagePoints = bulletData.damagePoints;
      bullet.direction = new THREE.Vector3(0, 0, -1);
      bullet.maxTime = bulletData.maxTime * 1000;
      bullet.name = bulletData.name + i;
      bullet.speed = bulletData.speed;
      bullet.time = 0;
      bullet.visible = false;
      this.pool[bulletData.name].push(bullet);
    }
  },

  /**
   * Register single target.
   */
  registerTarget: function (targetComponent) {
    var targetObj;
    this.targets.push(targetComponent.el);

    // Precalculate bounding box of bullet.
    targetObj = targetComponent.el.object3D;
    targetObj.boundingBox = new THREE.Box3().setFromObject(targetObj);
  },

  shoot: function (bulletName, gun) {
    var i;
    var oldest = 0;
    var oldestTime = 0;
    var pool = this.pool[bulletName];

    if (pool === undefined) { return null; }

    // Find available bullet and initialize it.
    for (i = 0; i < pool.length; i++) {
      if (pool[i].visible === false) {
        return this.shootBullet(pool[i], gun);
      } else if (pool[i].time > oldestTime){
        oldest = i;
        oldestTime = pool[i].time;
      }
    }

    // All bullets are active, pool is full, grab oldest bullet.
    return this.shootBullet(pool[oldest], gun);
  },

  shootBullet: function (bullet, gun) {
    bullet.visible = true;
    bullet.time = 0;
    gun.getWorldPosition(bullet.position);
    gun.getWorldDirection(bullet.direction);
    bullet.direction.multiplyScalar(-bullet.speed);
    this.container.add(bullet);
    return bullet;
  },

  tick: (function () {
    var bulletBox = new THREE.Box3();
    var bulletTranslation = new THREE.Vector3();
    var targetBox = new THREE.Box3();

    return function (time, delta) {
      var bullet;
      var i;
      var isHit;
      var targetObj;
      var t;

      for (i = 0; i < this.container.children.length; i++) {
        bullet = this.container.children[i];
        if (!bullet.visible) { continue; }
        bullet.time += delta;
        if (bullet.time >= bullet.maxTime) {
          this.killBullet(bullet);
          continue;
        }
        bulletTranslation.copy(bullet.direction).multiplyScalar(delta / 850);
        bullet.position.add(bulletTranslation);

        // Check collisions.
        bulletBox.setFromObject(bullet);
        for (t = 0; t < this.targets.length; t++) {
          let target = this.targets[t];
          if(target.getAttribute('target_bullet') != null){
            if (!target.getAttribute('target_bullet').active) { continue; }    
            targetObj = target.object3D;
            if (!targetObj.visible) { continue; }
            isHit = false;
            if (targetObj.boundingBox) {
              isHit = targetObj.boundingBox.intersectsBox(bulletBox);
            } else {
              targetBox.setFromObject(targetObj);
              isHit = targetBox.intersectsBox(bulletBox);
            }
            if (isHit) {
              this.killBullet(bullet);
              target.components.target_bullet.onBulletHit(bullet);
              target.emit('hit', null);
              break;
            }        
          }
        }
      }
    };
  })(),

  killBullet: function (bullet) {
    bullet.visible = false;
  }
});

/**
 * target component
 */
AFRAME.registerComponent('target_bullet', {
  schema: {
    active: {default: true},
    healthPoints: {default: 1, type: 'float'},
    static: {default: true},
  },

  init: function () {
    var el = this.el;
    el.addEventListener('object3dset', evt => {
      el.sceneEl.systems.bullet.registerTarget(this);
    });
  },

  update: function (oldData) {
    // `this.healthPoints` is current hit points with taken damage.
    // `this.data.healthPoints` is total hit points.
    this.healthPoints = this.data.healthPoints;
  },

  /**
   * Take damage.
   */
  onBulletHit: function (bullet) {
    if (!this.data.active) { return; }
    this.lastBulletHit = bullet;
    this.healthPoints -= bullet.damagePoints;
    // console.log(this.el.id)
    if (this.healthPoints <= 0) { this.el.emit('die'); }
  }
});

/**
 * Bullet template component
 */
AFRAME.registerComponent('bullet', {
  dependencies: ['material'],

  schema: {
    damagePoints: {default: 1.0, type: 'float'},
    maxTime: {default: 4.0, type: 'float'},  // seconds.
    name: {default: 'normal', type: 'string'},
    poolSize: {default: 10, type: 'int', min: 0},
    speed: {default: 8.0, type: 'float'}  // meters / sec.
  },

  init: function () {
    var el = this.el;
    el.object3D.visible = false;
    el.addEventListener('object3dset', evt => {
      el.sceneEl.systems.bullet.registerBullet(this);
    });
  }
});

AFRAME.registerComponent('enemy', {
  schema: {

  },

  init: function () {
    this.spawnPos = this.el.object3D.position.y;
    this.vulnerable = false;

    this.el.addEventListener('gamestart', this.gamestart.bind(this));
    this.el.addEventListener('die', this.enemydie.bind(this));
  },

  gamestart: function () {
    this.el.object3D.visible = true;
    this.vulnerable = true;
    this.spawnPos = this.el.object3D.position.y;

    // document.getElementById('title').object3D.visible = false;
    document.getElementById('start_button').object3D.visible = false;
    document.getElementById('howtoplay_button').object3D.visible = false;
    document.getElementById('score_display').object3D.visible = true;
    document.getElementById('health_display').object3D.visible = true;
  },

  enemydie: function () {
    var score_display = document.getElementById("score_display");
    console.log(score_display.getAttribute('value'));
    if(!this.vulnerable) {return;}
    score+=1;
    score_display.setAttribute('value', 'Score: ' + score);
    this.vulnerable = false;
    this.el.object3D.visible = false;
    setTimeout(() => {
      this.el.object3D.visible = true;
      this.vulnerable = true;
    }, 2000 + Math.floor(Math.random() * 3000));
  }
  
});

AFRAME.registerComponent('player', {
  schema: {
    
  },

  init: function () {
    this.el.addEventListener('hit', this.health_drop.bind(this));
    this.el.addEventListener('die', this.gamestop.bind(this));
  },

  health_drop: function() {
    var health_display = document.getElementById('health_display');
    health-=1;
    health_display.setAttribute('value', 'Health: ' + health);
  },

  gamestop: function () {
    console.log("berhenti");
    health = 3;
    score = 0;
    document.getElementById('song_game').components.sound.stopSound();
    document.getElementById('start_button').object3D.visible = true;
    document.getElementById('howtoplay_button').object3D.visible = true;
    document.getElementById('score_display').object3D.visible = false;
    document.getElementById('health_display').object3D.visible = false;
    this.el.emit('endgame');
  }
});

