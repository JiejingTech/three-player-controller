import * as THREE from 'three';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { OctreeHelper } from 'three/examples/jsm/helpers/octreeHelper.js';

import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { NavTouchPad, _NAV_TOUCH_DOWN, _NAV_TOUCH_UP } from './touch/NavTouchPad';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'

/**
 * 触控类型
 */
type TouchType = 'NAV' | 'ROTATE';

const EVENT_SWITCH_MODE = 'switchControllerMode';

/**
 * 鼠标左键
 */
const _MOUSE_LEFT_KEY = 0;
/**
 * 鼠标右键
 */
const _MOUSE_RIGHT_KEY = 2;

/**
 * 表示静止的向量
 */
const _STAY_VECTOR = new THREE.Vector2(0, 0);

/**
 * 世界Y轴
 */
const _yAxis = new THREE.Vector3(0, 1, 0);

/**
 * 缓存生效的触控信息
 */
class TouchInfo {
    constructor(
		// 标识符
        readonly identifier: number,
		// 触控开始位置
        readonly startPos: THREE.Vector2,
		// 当前位置
        readonly currPos: THREE.Vector2,
		// 触控类型（NAV/ROTATE）
        readonly touchType: TouchType,
    ) {}
}

/**
 * 用于配置PlayerNavController的配置信息
 */
export class PlayerNavSettings {
    /**
     * player的重力加速度
     */
    public gravity: number = 60;
    /**
     * 每帧处理频率
     */
    public stepsPerFrame: number = 5;
    /**
     * 触控模式下，移动位移在此幅度下认为是误差
     */
    public touchErrorRadius: number = 20;
    /**
     * player在x-z坐标轴出生点
     */
    public bornPos: THREE.Vector2 = new THREE.Vector2(0, 0);
    /**
     * player初始Y轴角度
     */
    public bornRotationY = 0;
    /**
     * player默认的视野在y轴的高度
     */
    public viewHeight: number = 0;
    /**
     * player胶囊对象的弧度，设置越大越容易翻越更高的障碍物
     */
    public playerCapsuleRadius = 0;
    /**
     * player在y轴位置低于该值被认为在坠落
     */
    public fallingThreshold = -25;
    /**
     * player跳跃y轴速度
     */
    public jumpUpVelocity = 30;
    /**
     * player移动时前进速度
     */
    public moveAcceleration = 75;
    /**
     * player跳跃时前进速度
     */
    public jumpAcceleration = 30;
    /**
     * 鼠标点击浏览器屏幕时候是否进入锁定
     */
    public lockScreenOnMouseClick = false;
    /**
     * 是否按住鼠标进行视角旋转，-1标识不需要
     */
    public holdMouseKeyToRotate = _MOUSE_RIGHT_KEY;
    /**
     * 鼠标移动放大系数
     */
    public mouseMoveScaleVector = new THREE.Vector2(50, 1000);
    /**
     * 触控移动放大系数
     */
    public touchMoveScaleVector = new THREE.Vector2(8000, 8000);
    /**
     * 事件重复timeout（毫秒）
     */
    public eventRepeatTimeout = 5;
    /**
     * 任务标记模型地址
     */
    public markerModelPath = '';
}

/**
 * 用于控制player移动和视角的控制器。
 */
export class PlayerController {
    /**
     * 容纳Threejs场景的html对象
     */
    private container: HTMLElement;
    /**
     * ThreeJS场景
     */
    private scene: THREE.Scene;
    /**
     * 空间索引，容纳用于进行碰撞检测的3d对象
     */
    private worldOctree: Octree;
    /**
     * 地板索引
     */
    private floorOctree: Octree = new Octree();
    /**
     * PlayerNavController的配置信息
     */
    private settings: PlayerNavSettings;
    /**
     * 代表player的「胶囊」对象，模拟和player发生碰撞时player的反应
     */
    private playerCollider: Capsule;
	/**
	 * player代理对象，使用内部camera实现
	 */
    private playerProxy = new THREE.Camera();
    /**
     * player的速度向量
     */
    private playerVelocity: THREE.Vector3 = new THREE.Vector3();
    /**
     * player是否站在地板上
     */
    private playerOnFloor: boolean = false;
    /**
     * 保存自动定位的坐标路径
     */
    private taskQueue = new Array<[string, THREE.Object3D]>();
    /**
     * 任务处理器，由用户提供
     */
    private taskProcessors = new Map<string, (target: THREE.Object3D, deltaTime: number) => void>();
    /**
     * 控制器输入但愿
     */
    private input: PlayerCtrlInput;
    /**
     * 控制器是否检测碰撞
     */
    public enableCollision = true;
    /**
     * 控制器角色状态机
     */
    private playerFsm = new PlayerCtrlFSM(this);

	/**
   	 * 控制器角色
   	 */
	private playerActor?: THREE.Object3D;

	/**
     * 控制器角色动作处理器
  	 */
	private playerPoseMixer?: THREE.AnimationMixer;

	private playerActorLoader?: (playerFsm: PlayerCtrlFSM, onLoaded: (playerActor: THREE.Object3D) => THREE.AnimationMixer) => void;

	private playerChaserPosition = new THREE.Vector3();

	private playerChaserLookAt = new THREE.Vector3();

    private useChaseCamera = false;
	/**
	 * player跳跃状态
	 */
    public isPlayerJumping = false;

	private marker?: THREE.Object3D;

	private markPos?: THREE.Vector3;

    constructor(container: HTMLElement, scene: THREE.Scene, octree: Octree, settings?: PlayerNavSettings) {
        this.container = container;
        this.scene = scene
        this.settings = settings || new PlayerNavSettings();
        this.worldOctree = octree;
        this.initFloor();

		// 初始化player代理对象
        this.playerProxy.rotation.order = 'YXZ';
        this.playerProxy.position.set(this.settings.bornPos.x, this.settings.viewHeight, this.settings.bornPos.y)
        this.playerProxy.rotateOnWorldAxis(_yAxis, this.settings.bornRotationY)

        // 初始化player的胶囊对象
        const playerFootPos = new THREE.Vector3(this.settings.bornPos.x, this.settings.playerCapsuleRadius, this.settings.bornPos.y)
        const playerHeadPos = new THREE.Vector3(this.settings.bornPos.x, this.settings.viewHeight, this.settings.bornPos.y)
        this.playerCollider = new Capsule(playerFootPos, playerHeadPos, this.settings.playerCapsuleRadius );

		// 初始化输入对象
        this.input = new PlayerCtrlInput(this.container, this.settings);
		// 启动player状态机
        this.playerFsm.startup('idle');

        if (this.settings.markerModelPath.length > 0) {
		    this.initMarker(this.settings.markerModelPath);
        }

		this.initEventListeners();
    }

	/**
	 * 更新摄像头
	 * @param camera 外部摄像头对象
	 * @param deltaTime delta时间段
	 */
    public updateCamera(camera: THREE.Camera, deltaTime: number) {
        if (this.useChaseCamera) {
            this.updateChaseCamera(camera, deltaTime);
        } else {
            this.updateFpsCamera(camera, deltaTime);
        }
    }

	/**
	 * 更新第一人称摄像头
	 * @param fpsCamera 第一人称摄像头
	 * @param deltaTime delta时间段
	 */
    public updateFpsCamera(fpsCamera: THREE.Camera, deltaTime: number) {
        fpsCamera.position.copy(this.playerProxy.position);
        fpsCamera.lookAt(this.getPlayerLookAt());
    }

	/**
	 * 更新第三人称摄像头
	 * @param tpsCamera 第三人称摄像头
	 * @param deltaTime  delta时间段
	 * @returns 
	 */
    public updateChaseCamera(tpsCamera: THREE.Camera, deltaTime: number) {
        if (!this.playerActor) {
            return;
        }

		// 设置摄像头偏离位置
        const idealOffset = new THREE.Vector3(-5, 14, -15);
        idealOffset.applyQuaternion(this.playerActor.quaternion);
        idealOffset.add(this.playerActor.position);

		// 设置摄像头视角
        const idealLookat = new THREE.Vector3(0, 12, 10);
        idealLookat.applyQuaternion(this.playerActor.quaternion);
        idealLookat.add(this.playerActor.position);

        const t = 1.0 - Math.pow(0.001, deltaTime);

        this.playerChaserPosition.lerp(idealOffset, t);
        this.playerChaserLookAt.lerp(idealLookat, t);

        tpsCamera.position.copy(this.playerChaserPosition);
        tpsCamera.lookAt(this.playerChaserLookAt);
    }

    /**
     * 刷新控制器，更新视角和player位置
     * @param delta 增量事件（ms）
     */
    public update(delta: number) {
        this.playerFsm.update(delta, this.input);
        // 刷新控制器各个向量
        this.updateControls( delta);
        // 更新player位置和视角
        this.updatePlayer( delta);
        // 如果player坠落将其复位
        this.rebornPlayerIfFall();
		this.updateMarker(delta);
    }

    /**
     * 看向目标
     * @param target 目标坐标
     * @param deltaTime 间隔事件
     */
    public aimFor(target: THREE.Vector3, deltaTime: number) {
        const deltaLookAt = new THREE.Vector3(0, 0, -1);
        deltaLookAt.applyQuaternion(this.playerProxy.quaternion);
        deltaLookAt.add(this.playerProxy.position);
        deltaLookAt.lerp(target, deltaTime);
        this.playerProxy.lookAt(deltaLookAt);
    }

    /**
     * 向目标位置靠近
     * @param target 目标坐标 
     * @param deltaTime 间隔时间
     * @returns 移动前距离目位置距离
     */
    public moveTowards(target: THREE.Vector3, deltaTime: number): number {
        const speedDelta = deltaTime * ( this.playerOnFloor ? this.settings.moveAcceleration : this.settings.jumpAcceleration ) *  (this.playerFsm.state === 'run' ? 2: 1);
        const cameraPlanePos = new THREE.Vector2(this.playerProxy.position.x, this.playerProxy.position.z);
        const targetPlanePos = new THREE.Vector2(target.x, target.z);
        const planeDistance = cameraPlanePos.distanceTo(targetPlanePos);

        const moveVector = this.getDirectionVectorByLookAt(target);	
        if ( moveVector.y != 0 || moveVector.x != 0) {
            this.playerVelocity.add( moveVector.multiplyScalar(speedDelta))
        }
        return planeDistance;
    }

    /**
     * 用于外部控制任务
     */
    get tasks() {
        return this.taskQueue;
    }

    /**
     * 注册任务处理器
     * @param task 任务类型
     * @param processor 任务处理器 
     */
    public registerTaskProcessor(task: string, processor: (target: THREE.Object3D, deltaTime: number) => void) {
        this.taskProcessors.set(task, processor);
    }

	/**
	 * 设置actor加载器
	 * @param loader actor加载器
	 */
	public setActorLoader(loader: (playerFsm: PlayerCtrlFSM, actorSaver: (playerActor: THREE.Object3D) => THREE.AnimationMixer) => void) {
		this.playerActorLoader = loader;
	}

	/**
	 * 切换至跟随模式摄像头
	 */
	private switchToChaseCameraMode() {
		if (!this.useChaseCamera) {
			if (this.playerActor) {
				this.playerActor.visible = true;
				this.useChaseCamera = true;
			} else if (this.playerActorLoader) {
				this.playerActorLoader(this.playerFsm, (actor) => {
					this.playerActor = actor;
					this.playerActor.visible = true;
					this.playerActor.position.set(this.settings.bornPos.x, this.playerCollider.start.y - this.playerCollider.radius, this.settings.bornPos.y)
					this.scene.add(this.playerActor);
					this.playerPoseMixer = new THREE.AnimationMixer(this.playerActor);
					this.useChaseCamera = true;
					return this.playerPoseMixer!;
				})
			}
		} 
	}

	private unmark() {
		if (this.marker) {
			this.scene.remove(this.marker);
			this.markPos = undefined;
		}
	}

	public mark(pos:THREE.Vector3) {
		if (this.marker) {
			this.unmark();
			this.marker.position.copy(pos);
			this.scene.add(this.marker);
			this.markPos = pos;
		}
	}

	/**
	 * 初始化事件监听器
	 */
	private initEventListeners() {

		// 监听键盘按键，切换摄像头模式
		document.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.code === 'Digit1') {
                this.useChaseCamera = false;
                if (this.playerActor) {
                    this.playerActor.visible = false;
                }
            }
            if (event.code === 'Digit2') {
				this.switchToChaseCameraMode();
            }
        });

		// 监听控制器iput对象发来的长按事件，切换摄像哦图视角
		document.addEventListener(EVENT_SWITCH_MODE, ((event: CustomEvent<THREE.Vector2>) => {
			if (!this.useChaseCamera) {
				this.switchToChaseCameraMode();
			} else {
				this.useChaseCamera = false;
                if (this.playerActor) {
                    this.playerActor.visible = false;
                }	
			}	
        }) as EventListener);
	}

	/**
	 * 初始化marker对象
	 */
	private initMarker(modelPath: string) {
        const loader = new GLTFLoader();
		loader.load(modelPath, (gltf) => {
            gltf.scene.traverse(c => {
                c.castShadow = false;
            });
            gltf.scene.scale.set(5,5,5)
			this.marker = gltf.scene;
        });
	}

	/**
	 * 更新控制器
	 * @param deltaTime delta时间段
	 */
    private updateControls( deltaTime: number ) {

        if (this.taskQueue.length) {
            const [action, target] = this.taskQueue[0];
            const taskProcessFunc = this.taskProcessors.get(action); 
            if (taskProcessFunc) {
				if (target.userData.needMove) {
					const toMarkPos = new THREE.Vector3(target.userData.playerPos.x, this.settings.viewHeight, target.userData.playerPos.y);
					if (!this.markPos || this.markPos != toMarkPos) {
						this.mark(toMarkPos);
					}
				} else {
					this.unmark();
				}
                taskProcessFunc(target, deltaTime);
            }
        } else {
            let inputNavVector = this.input.getNavVector();
            if (this.useChaseCamera && Math.abs(inputNavVector.x) > 0.3) {
                inputNavVector.y = 0;
                inputNavVector = inputNavVector.normalize();
                this.playerProxy.rotation.y -= inputNavVector.x / 50;
            } else {
                let inputRotateVector = this.input.getRotateVector();
                if (inputRotateVector.x != 0 || inputRotateVector.y != 0) {
                    this.playerProxy.rotation.y -= inputRotateVector.x;
                    this.playerProxy.rotation.x -= inputRotateVector.y;
                }
            }
        }
    }

	/**
	 * 更新player对象
	 * @param deltaTime delta时间段
	 */
    private updatePlayer( deltaTime: number ) {

		// 获取输入的nav向量
        let inputNavVector = this.input.getNavVector();

		// 如果是第三人称模式，忽略nav向量在X轴分量
		// TODO：以后如果支持「元神」模式的跟踪摄像头，这个限制可以放开
        if (this.useChaseCamera) {
            inputNavVector.x = 0
            inputNavVector = inputNavVector.normalize();
        }

		// 计算该delta时间段内速度增量
		// 考虑地面移动/跳跃；行走/奔跑时的不同参数
        const speedDelta = deltaTime * ( this.playerOnFloor ? this.settings.moveAcceleration : this.settings.jumpAcceleration ) * (this.playerFsm.state === 'run' ? 2: 1);

		// 将nav向量转化为player速度向量
        if ( inputNavVector.y != 0 || inputNavVector.x != 0) {
            // 将输入Nav向量转化为fps摄像头面向方向的分量
            this.playerVelocity.add( this.getForwardVector().multiplyScalar( inputNavVector.y * speedDelta ) );
            this.playerVelocity.add( this.getSideVector().multiplyScalar( inputNavVector.x * speedDelta ) );
        }

		// 获取输入中的player跳跃flag，true标识此刻player开始跳跃
        let playerToJump = this.input.getJumpFlag();
		// 如果player在地板上
        if ( this.playerOnFloor) {
			// 如果此时player还不处于跳跃状态
            if (playerToJump && !this.isPlayerJumping) {
                console.log('player jump at ', JSON.stringify(this.playerProxy.position));
                this.playerVelocity.y = this.settings.jumpUpVelocity;
                this.isPlayerJumping = true;
            }
			// 否则表示player在跳跃后已经接触地面，充值跳跃状态，使动作展示正常
            else if (this.isPlayerJumping) {
                this.isPlayerJumping = false;
            }
        }

		// 处理空中空气阻力和重力加速度对player位置和速度的影响
        let damping = Math.exp( - 4 * deltaTime ) - 1;
        if ( ! this.playerOnFloor ) {
            this.playerVelocity.y -= this.settings.gravity * deltaTime;
            // small air resistance
            damping *= 0.1;
        } 
        this.playerVelocity.addScaledVector( this.playerVelocity, damping );

		// 处理player碰撞检测
        const deltaPosition = this.playerVelocity.clone().multiplyScalar( deltaTime );
        this.playerCollider.translate( deltaPosition );
        this.playerCollisions();

		// 更新player代理对象位置
        this.playerProxy.position.copy( this.playerCollider.end );

		// 更新player角色信息
		this.updateActor(deltaTime);
    }

	/**
	 * 更新player角色动作动画
	 * @param delta delta时间段
	 */
	private updateActor(delta: number) {
		if (this.playerActor && this.playerActor.visible) {
            this.playerActor.position.copy(this.playerProxy.position)

            const floorHeight = this.playerCollider.start.y - this.playerCollider.radius;
            this.playerActor.position.y = floorHeight;

            let actorLookAt = this.getPlayerLookAt();
            actorLookAt.y = floorHeight;
            this.playerActor.lookAt(actorLookAt);

            if (this.playerPoseMixer) {
                this.playerPoseMixer.update(delta);
            }
        }
	}

	/**
	 * 更新marker对象
	 * @param deltaTime delta时间段
	 */
	private updateMarker(deltaTime: number) {
		if (this.marker && this.markPos) {
			this.marker.rotateOnAxis(_yAxis, 0.1);
			this.marker.position.y = this.markPos.y + Math.sin(new Date().getTime() / 100);
		}
	}

	/**
	 * @returns 获取player看向的位置
	 */
    private getPlayerLookAt(): THREE.Vector3 {
        const playerLookAt = new THREE.Vector3(0, 0, -1);
        playerLookAt.applyQuaternion(this.playerProxy.quaternion);
        playerLookAt.add(this.playerProxy.position);
        return playerLookAt;
    }

    /**
     * 返回摄像头「看向」的方向向量
     * @returns 获取player前进的向量
     */
    private getForwardVector() {
        let playerDirection = new THREE.Vector3();
        this.playerProxy.getWorldDirection( playerDirection );
        // 由于考虑重力，y轴永远置0
        playerDirection.y = 0;
        playerDirection.normalize();

        return playerDirection;
    }

    /**
     * 返回摄像头「看向」的侧向向量
     * @returns 获取player前进侧向的向量
     */
    private getSideVector() {
        let playerDirection = new THREE.Vector3();
        this.playerProxy.getWorldDirection( playerDirection );
        playerDirection.y = 0;
        playerDirection.normalize();
        playerDirection.cross( this.playerProxy.up );

        return playerDirection;
    }

	/**
	 * @param lookAt 指定的看向位置
	 * @returns 获取方向向量
	 */
    private getDirectionVectorByLookAt(lookAt: THREE.Vector3): THREE.Vector3 {
        let playerDirection = new THREE.Vector3();
        let cameraProxy = this.playerProxy.clone();
        cameraProxy.lookAt(lookAt);
        cameraProxy.getWorldDirection( playerDirection );
        // 由于考虑重力，y轴永远置0
        playerDirection.y = 0;
        playerDirection.normalize();

        return playerDirection;
    }

	/**
	 * 处理player对象碰撞
	 */
    private playerCollisions() {
		// 如果不开启碰撞检测，只使用地板，不加载任何其他空间对象进行碰撞检测
        const checkOctree = this.enableCollision ? this.worldOctree : this.floorOctree;
        const result = checkOctree.capsuleIntersect( this.playerCollider );
        this.playerOnFloor = result ? result.normal.y > 0 : false

        if ( result ) {
            if ( ! this.playerOnFloor ) {
                this.playerVelocity.addScaledVector( result.normal, - result.normal.dot( this.playerVelocity ) );
            }
            this.playerCollider.translate( result.normal.multiplyScalar( result.depth ) );

        }

    }

    /**
     * 如果player坠落将其复位
     */
    private rebornPlayerIfFall() {
        if ( this.playerProxy.position.y <= this.settings.fallingThreshold ) {
            this.playerCollider.start.set( this.settings.bornPos.x, this.settings.playerCapsuleRadius, this.settings.bornPos.y);
            this.playerCollider.end.set( this.settings.bornPos.x, this.settings.viewHeight, this.settings.bornPos.y );
            this.playerCollider.radius = this.settings.playerCapsuleRadius;
            this.playerProxy.position.copy( this.playerCollider.end );
            this.playerProxy.rotation.set( 0, 0, 0 );
            this.playerProxy.rotateOnWorldAxis(_yAxis, this.settings.bornRotationY)
        }
    }

    /**
     * 初始化地面隐形面，用于防止player坠落
     */
    private initFloor() {
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(1000, 1000, 10, 10),
            new THREE.MeshStandardMaterial({
                color: 0x808080,
                // transparent设置为true，开启透明，否则opacity不起作用
                transparent: true,
                // 设置材质透明度
                opacity: 0,
            }));
            plane.castShadow = false;
            plane.receiveShadow = false;
            plane.rotation.x = -Math.PI / 2;
            this.worldOctree.fromGraphNode(plane);
            this.floorOctree.fromGraphNode(plane);
            this.scene.add(plane);
    }


}

/**
 * player控制器输入对象
 */
class PlayerCtrlInput {
    /**
     * 容纳Threejs场景的html对象
     */
    private container: HTMLElement;
    /**
     * PlayerNavController的配置信息
     */
    private settings: PlayerNavSettings;
    /**
     * 是否在移动设备端打开
     */
    private onMobile: boolean;
    /**
     * 目前按下对键盘按键
     */
    private activetKeys = new Set<String>();
    /**
     * 目前处于生效的触控点
     */
    private activeTouches = new Map<number, TouchInfo>();
    /**
     * 目前处于生效的触控类型
     */
    private activeToucheTypes = new Map<string, number>();
    /**
     * 目前按下的鼠标按键
     */
    private activeMouseKeys = new Set<number>();
    /**
     * 控制player移动的触控按钮
     */
    private navTouchPad?: NavTouchPad;
    /**
     * 移动触控相应区域中心
     */
    private navTouchCenter?: THREE.Vector2;
    /**
     * 移动触控区域大小
     */
    private navTouchSize?: number;
    /**
     * 鼠标移动位移响亮
     */
    private mouseMoveVector = new THREE.Vector2(0, 0);
    /**
     * 事件分发定时器
     */
    private eventRepeatTimer?: number;

	private switchModeTimer?: number;

    constructor(container: HTMLElement, settings: PlayerNavSettings) {
        this.settings = settings;
        this.container = container;
        this.onMobile = "ontouchstart" in document.documentElement;

        if (this.onMobile) {
            const [navTouchCenter, touchSize, _] = this.evalNavTouchLayout();
            this.navTouchCenter = navTouchCenter;
            this.navTouchSize = touchSize;
            this.navTouchPad = new NavTouchPad(this.container, this.evalNavTouchLayout);
        }

        this.addEventListeners();
    }

    public getNavVector(): THREE.Vector2 {
        if (this.onMobile) {
            const navTouchId = this.activeToucheTypes.get('NAV');
            const navTouchPos = navTouchId !== undefined ? this.activeTouches.get(navTouchId): undefined;
            const navTouchVector = navTouchPos ?
                new THREE.Vector2(
                    Math.abs(navTouchPos.currPos.x - this.navTouchCenter!.x) <= this.settings.touchErrorRadius ? 0: navTouchPos.currPos.x - this.navTouchCenter!.x,
                        Math.abs(navTouchPos.currPos.y - this.navTouchCenter!.y) <= this.settings.touchErrorRadius ? 0: this.navTouchCenter!.y - navTouchPos.currPos.y
            ).normalize() : _STAY_VECTOR;
            return navTouchVector;
        }
        else {
            const navVector = new THREE.Vector2(this.activetKeys.has('KeyD') ? 1 : this.activetKeys.has('KeyA') ? -1 : 0, this.activetKeys.has('KeyW') ? 1 : this.activetKeys.has('KeyS') ? -1 : 0);
            return navVector.normalize();
        }
    }

    public getRotateVector(): THREE.Vector2 {
        if (this.onMobile) {
            const rotateVectorId = this.activeToucheTypes.get('ROTATE');
            const rotateVector = rotateVectorId !== undefined ? this.activeTouches.get(rotateVectorId): undefined;
            return rotateVector ? new THREE.Vector2(
                (rotateVector.currPos.x - rotateVector.startPos.x) / this.settings.touchMoveScaleVector.x,
                (rotateVector.currPos.y - rotateVector.startPos.y) / this.settings.touchMoveScaleVector.y): _STAY_VECTOR;
        } else {
            // const rotateVector = new THREE.Vector2(
            // this.mouseMoveVector.x / this.settings.mouseMoveScaleVector.x,
            // this.mouseMoveVector.y / this.settings.mouseMoveScaleVector.y);
            const rotateVector = new THREE.Vector2(
                this.mouseMoveVector.x / window.innerWidth,
                this.mouseMoveVector.y / window.innerHeight).normalize().divide(this.settings.mouseMoveScaleVector);
                this.mouseMoveVector.set(0, 0);
                return rotateVector;
        }
    }

    public getJumpFlag(): boolean {
        if (this.onMobile) {
            // TODO 屏幕上需要专门的控件按钮
            return false;
        } else {
            return this.activetKeys.has('Space');
        }
    }

    public getRunFlag(): boolean {
        if (this.onMobile) {
            const navTouchId = this.activeToucheTypes.get('NAV');
            const navTouch = navTouchId !== undefined ? this.activeTouches.get(navTouchId): undefined;
			if (!navTouch) {
				return false;
			}
			return new THREE.Vector2(navTouch.currPos.x, navTouch.currPos.y).distanceTo(this.navTouchCenter!) > 45;
        } else {
            return this.activetKeys.has('ShiftLeft') || this.activetKeys.has('ShiftRight');
        }
    }

    /**
     * 初始化所有控制器时间listener
     */
    private addEventListeners() {
        this.container.addEventListener('contextmenu', (evt) => evt.preventDefault());

        if (this.onMobile) {
            window.addEventListener("resize", this.handleWindowResize.bind(this), false);

            // 注意，这里的passive参数必须设置，否则无法禁止浏览器对touch事件的响应
            document.addEventListener('touchstart', this.handleTouchStart.bind(this),  { passive: false });
            document.addEventListener('touchend', this.handleTouchEnd.bind(this),  { passive: false });
            document.addEventListener('touchmove', this.handleTouchMove.bind(this),  { passive: false });
            document.addEventListener('touchcancel', this.handleTouchCancel.bind(this),  { passive: false });

            // 触摸板禁止手指缩放
            document.addEventListener('wheel', function(event) {
                event.preventDefault()
            }, { passive: false })
        } else {

            // 鼠标事件监听
            this.container.addEventListener('mousemove', this.handleMouseMove.bind(this));
            this.container.addEventListener('mousedown', this.handleMouseDown.bind(this));
            this.container.addEventListener('mouseup', this.handleMouseUp.bind(this));

            // 键盘事件舰艇
            document.addEventListener('keydown', this.handleKeyDown.bind(this));
            document.addEventListener('keyup', this.handleKeyUp.bind(this));
        }
    }


    /**
     * 鼠标按键处理器
     * @param event 处理鼠标按下事件
     */
    private handleMouseDown(event: MouseEvent) {
        if (!this.onMobile) {
            // PC浏览器上处理
            if (this.settings.lockScreenOnMouseClick) {
                // 如果需要点击锁屏，申请锁屏
                if (document.pointerLockElement !== document.body) {
                    document.body.requestPointerLock()
                }
            } else {
                // 否则记录鼠标按键
                this.activeMouseKeys.add(event.button);
            }
        }
    }

    /**
     * 鼠标按键松开处理函数
     * @param event 鼠标按键松开事件
     */
    private handleMouseUp(event: MouseEvent) {
        if (!this.onMobile) {
            const hit = new THREE.Vector2();
            hit.x = ( event.pageX / document.body.clientWidth ) * 2 - 1;
            hit.y = - ( event.pageY / document.body.clientHeight ) * 2 + 1;

            if (this.activeMouseKeys.has(_MOUSE_LEFT_KEY) && this.activeMouseKeys.size == 1) {
                this.sendHitOnViewEvent(hit);
            }

            this.activeMouseKeys.delete(event.button);
        }	
    }

    /**
     * 处理鼠标移动事件
     * @param event 鼠标移动事件 
     */
    private handleMouseMove(event: MouseEvent) {
        if (!this.onMobile) {
            // 只有开启页面鼠标锁定才生效
            // 注意：移动端touch也会触发这个事件，如果不加这个限制条件，ios会僵死
            // 目前原因不明
            if ( !this.settings.lockScreenOnMouseClick || document.pointerLockElement === document.body ) {
                if (this.settings.holdMouseKeyToRotate < 0 || this.activeMouseKeys.has(this.settings.holdMouseKeyToRotate)) {
                    this.mouseMoveVector.set(event.movementX, event.movementY);
                }
            }
        }
    }

    /**
     * 处理按键被按下事件
     * @param event 按键按下事件
     */
    private handleKeyDown(event: KeyboardEvent) {
        if (event.code.indexOf('Digit') < 0) {
            this.activetKeys.add(event.code);
        }
    }

    /**
     * 处理按键按下后被抬起
     * @param event 按键抬起事件
     */
    private handleKeyUp(event: KeyboardEvent) {
        if (event.code.indexOf('Digit') < 0) {
            this.activetKeys.delete(event.code);
        }
    }

    /**
     * 处理触控开始
     * @param event 触控开始事件
     */
    private handleTouchStart(event: TouchEvent) {
        event.stopPropagation();
        event.preventDefault();
        const touches = event.changedTouches;

        for (let i = 0; i < touches.length; i++) {
            this.registerTouch(touches[i]);
        }
    }

    /**
     * 处理触控移动
     * @param event 触控移动事件
     */
    private handleTouchMove(event: TouchEvent) {
        event.stopPropagation();
        event.preventDefault();
        const touches = event.changedTouches;

        for (let i = 0; i < touches.length; i++) {
            this.updateTouch(touches[i]);
        }
    }

    /**
     * 处理触控结束
     * @param event 触控结束事件
     */
    private handleTouchEnd(event: TouchEvent) {
        event.stopPropagation();
        event.preventDefault();
        const touches = event.changedTouches;
        const firstTouch = touches[0];
        const origTouch = this.activeTouches.get(firstTouch.identifier);

        if (origTouch
            && Math.abs(firstTouch.clientX - origTouch.startPos.x) <= this.settings.touchErrorRadius
        && Math.abs(firstTouch.clientY - origTouch.startPos.y) <= this.settings.touchErrorRadius) {

            const hit = new THREE.Vector2();
            hit.x = ( touches[0].pageX / document.body.clientWidth ) * 2 - 1;
            hit.y = - ( touches[0].pageY / document.body.clientHeight ) * 2 + 1;
            this.sendHitOnViewEvent(hit);
        }

        for (let i = 0; i < touches.length; i++) {
            this.deregisterTouch(touches[i])
        }
    }

    /**
     * 处理触控取消
     * @param event 触控取消事件
     */
    private handleTouchCancel(event: TouchEvent) {
        event.stopPropagation();
        event.preventDefault();
        const touches = event.changedTouches;

        for (let i = 0; i < touches.length; i++) {
            this.deregisterTouch(touches[i])
        }
    }
	
	/**
	 * 处理窗口重置大小
	 */
    private handleWindowResize() {
        const [navTouchCenter, touchSize, _] = this.evalNavTouchLayout();
        this.navTouchCenter = navTouchCenter;
        this.navTouchSize = touchSize;

        if (this.navTouchPad) {
            this.navTouchPad.handleWindowResize();
        }
    }
	/**
	 * 注册触控对象
	 * @param touch 触控对象
	 */
    private registerTouch(touch: Touch) {
        const touchPos = new THREE.Vector2(touch.pageX, touch.pageY);
        if (this.activeTouches.size >= 2) {
            return;
        }

        const touchType = this.detectTouchType(touch);
        if (this.activeToucheTypes.has(touchType)) {
            return;
        }

        const toAddTouch = new TouchInfo(touch.identifier, touchPos, touchPos, touchType);

        if ('NAV' === touchType) {
            this.sendTouchEvent(_NAV_TOUCH_DOWN, touchPos);

			if (touchPos.distanceTo(this.navTouchCenter!) <= this.settings.touchErrorRadius) {
				if (this.switchModeTimer) {
					clearTimeout(this.switchModeTimer);
				}
				this.switchModeTimer = setTimeout(() => {
					let touchEvent = new CustomEvent(EVENT_SWITCH_MODE, {
						bubbles: false,
						detail: {},
					})
					document.dispatchEvent(touchEvent)
				}, 2000);
			}
        }

        this.activeTouches.set(toAddTouch.identifier, toAddTouch);
        this.activeToucheTypes.set(touchType, toAddTouch.identifier);
    }

	/**
	 * 更新触控信息
	 * @param touch 触控对象
	 */
    private updateTouch(touch: Touch) {
        const touchPos = new THREE.Vector2(touch.pageX, touch.pageY);
        const origTouch = this.activeTouches.get(touch.identifier);
        if (origTouch) {
            const newTouch = new TouchInfo(touch.identifier, origTouch.startPos, touchPos, origTouch.touchType);

            if ('NAV' === origTouch.touchType) {
                this.sendTouchEvent(_NAV_TOUCH_DOWN, touchPos);

				if (touchPos.distanceTo(this.navTouchCenter!) > this.settings.touchErrorRadius) {
					if (this.switchModeTimer) {
						clearTimeout(this.switchModeTimer);
					}
				}
            }

            this.activeTouches.set(touch.identifier, newTouch)
        }
    }

	/**
	 * 注销触控信息
	 * @param touch 触控对象
	 */
    private deregisterTouch(touch: Touch) {
        const origTouch = this.activeTouches.get(touch.identifier);
        if (origTouch) {
            if ('NAV' === origTouch.touchType) {
                this.sendTouchEvent(_NAV_TOUCH_UP);

				if (this.switchModeTimer) {
					clearTimeout(this.switchModeTimer);
				}
            }
            this.activeTouches.delete(touch.identifier);
            this.activeToucheTypes.delete(origTouch.touchType);
        }
    }

    /**
     * 分发触控事件
     * @param eventType 触控事件类型
     * @param touchPos 触控位置  
     */
    private sendTouchEvent(eventType: string, touchPos?: THREE.Vector2) {
        if (this.eventRepeatTimer) {
            clearTimeout(this.eventRepeatTimer)
        }
        this.eventRepeatTimer = setTimeout(() => {
            this.sendTouchEvent(eventType, touchPos)
        }, this.settings.eventRepeatTimeout)

        let touchEvent = new CustomEvent(eventType, {
            bubbles: false,
            detail: touchPos,
        })
        document.dispatchEvent(touchEvent)
    }

	/**
	 * 发布屏幕点击事件
	 * @param selectPos 点击位置
	 */
    private sendHitOnViewEvent(selectPos: THREE.Vector2) {
        let touchEvent = new CustomEvent('hitOnView', {
            bubbles: false,
            detail: selectPos,
        })
        document.dispatchEvent(touchEvent)
    }

    /**
     * 计算Nav触控的layout信息
     * @returns Nav触控layout信息对象
     */
    private evalNavTouchLayout() : [THREE.Vector2, number, number] {
        const windowLimit = Math.min(window.innerHeight, window.innerWidth);
        if (window.orientation === 90 || window.orientation === -90) {
            return [new THREE.Vector2(windowLimit / 3, windowLimit * 2 / 3), windowLimit * 2 / 3, windowLimit * 2 / 5];
        }
        return [new THREE.Vector2(windowLimit / 2, window.innerHeight - windowLimit / 3), windowLimit * 2 / 3, windowLimit * 2 / 5];
    }
    /**
     * 解析触控的类型（Nav/Rotate）
     * @param touch 触控对象
     * @returns 触控类型
     */
    private detectTouchType(touch: Touch): TouchType {
        if (this.navTouchCenter && this.navTouchSize) {
            if (touch.clientX > Math.max(0, this.navTouchCenter.x - this.navTouchSize / 2)
                && touch.clientX < Math.min(window.innerWidth, this.navTouchCenter.x + this.navTouchSize / 2)
            && touch.clientY > Math.max(0, this.navTouchCenter.y - this.navTouchSize / 2)
            && touch.clientY < Math.min(window.innerHeight, this.navTouchCenter.y + this.navTouchSize / 2)) {
                return 'NAV';
            } else {
                return 'ROTATE';
            }
        }
        return 'NAV';
    }
}

/**
 * 有限状态机
 */
class FiniteStateMachine {

	/**
	 * 状态集合
	 */
    private states = new Set<string>();
	/**
	 * 当前状态
	 */
    private currentState?: string;
	/**
	 * 状态转移
	 */
    private transitions = new Map<string, Map<string, (deltaTime: number, input: any) => boolean>>();
	/**
	 * 状态进入函数
	 */
    private onEnterFuncs = new Map<string, (prevState?: string) => void>();
	/**
	 * 状态退出函数
	 */
    private onExitFuncs = new Map<string, () => void>();
	/**
	 * 添加状态
	 * @param state 状态key
	 * @param onEnter 状态进入函数
	 * @param onExit 状态退出函数
	 */
    public addState(state: string, onEnter?: (prevState?: string) => void, onExit?: () => void) {
        this.states.add(state);
        if (onEnter) {
            this.onEnterFuncs.set(state, onEnter);
        }
        if (onExit) {
            this.onExitFuncs.set(state, onExit);
        }
    }
	/**
	 * 注册状态进入函数
	 * @param state 状态key
	 * @param onEnter 状态进入函数
	 */
    public registerEnterFunc(state: string, onEnter: (prevState?: string) => void) {
        this.onEnterFuncs.set(state, onEnter);
    }
	/**
	 * 注册状态退出函数
	 * @param state 状态key
	 * @param onExit 状态退出函数
	 */
    public registerExitFunc(state: string, onExit:  () => void) {
        this.onExitFuncs.set(state, onExit);
    }
	/**
	 * 添加状态转移
	 * @param sourceState 起始状态
	 * @param targetState 目标状态
	 * @param checkFunc guard函数，是否进行转移
	 */
    public addTransition(sourceState: string, targetState: string, checkFunc: (deltaTime: number, input: any) => boolean) {
        if (!this.transitions.has(sourceState)) {
            this.transitions.set(sourceState, new Map<string, (deltaTime: number, input: any) => boolean>())
        }
        this.transitions.get(sourceState)!.set(targetState, checkFunc);
    }
	/**
	 * 在初始状态开启状态机器
	 * @param initState 初始状态
	 */
    public startup(initState: string) {
        this.currentState = initState;
    }
	/**
	 * 更新函数
	 * @param deltaTime delta时间段
	 * @param input 
	 */
    public update(deltaTime: number, input: any) {
        if (this.currentState && this.transitions.has(this.currentState)) {
            const transitionsByTarget = this.transitions.get(this.currentState)
            for ( let [targetState, checkFunc] of Array.from(transitionsByTarget!.entries()) ) {
                if (checkFunc(deltaTime, input)) {
                    this.transition(targetState);
                }
            }
        }
    }
	/**
	 * 状态转移过程
	 * @param targetState 目标状态
	 * @returns 
	 */
    private transition(targetState: string) {
        const prevState = this.currentState;

        if (prevState) {
            if (prevState == targetState) {
                return;
            }
            if (this.onExitFuncs.has(prevState)) {
                this.onExitFuncs.get(prevState)!()
            }
        }

        this.currentState = targetState;
        if (this.onEnterFuncs.has(targetState)) {
            this.onEnterFuncs.get(targetState)!(prevState);
        }
        console.log('FSM: ' + prevState + ' => ' + targetState);
    }
	/**
	 * getter函数：当前状态
	 */
    get state() {
        return this.currentState;
    }
};

/**
 * player有限状态机
 */
export class PlayerCtrlFSM extends FiniteStateMachine {

    private context: PlayerController;

    constructor(controller: PlayerController) {
        super();
        this.context = controller;
        this.init();
    }

    private init() {
		// 初始化内建状态
        this.addState('idle');
        this.addState('walk');
        this.addState('run');
        this.addState('jump');

		// 添加行走、跑动状态转移
        this.addTransition('idle', 'walk', (deltaTime: number, input: PlayerCtrlInput) => {
            return input.getNavVector().length() > 0 || this.hasTaskNeedMove();
        })
        this.addTransition('walk', 'idle', (deltaTime: number, input: PlayerCtrlInput) => {
            return input.getNavVector().length() == 0 && !this.hasTaskNeedMove();
        })
        this.addTransition('walk', 'run', (deltaTime: number, input: PlayerCtrlInput) => {
            return input.getRunFlag() || this.hasTaskNeedRun();
        })
        this.addTransition('run', 'walk', (deltaTime: number, input: PlayerCtrlInput) => {
            return !input.getRunFlag() && !this.hasTaskNeedRun();
        }) 

		// 添加跳跃状态转移
        this.addTransition('idle', 'jump', (deltaTime: number, input: PlayerCtrlInput) => {
            return input.getJumpFlag();
        })
        this.addTransition('walk', 'jump', (deltaTime: number, input: PlayerCtrlInput) => {
            return input.getJumpFlag();
        })
        this.addTransition('run', 'jump', (deltaTime: number, input: PlayerCtrlInput) => {
            return input.getJumpFlag();
        })
        this.addTransition('jump', 'run', (deltaTime: number, input: PlayerCtrlInput) => {
            return !this.context.isPlayerJumping;
        })

    }

	/**
	 * @returns 是否存在需要移动的任务
	 */
	private hasTaskNeedMove() {
		return this.context.tasks.length > 0 && this.context.tasks[0][1].userData.needMove;	
	}

	/**
	 * @returns 是否存在需要跑步移动的任务
	 */
	private hasTaskNeedRun() {
		return this.context.tasks.length > 0 && this.context.tasks[0][1].userData.needRun;	
	}
}
