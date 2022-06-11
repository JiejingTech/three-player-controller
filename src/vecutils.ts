import * as THREE from 'three';

/**
 * 返回摄像头「看向」的方向向量
 * @returns 获取player前进的向量
 */
function getForwardVector(obj: THREE.Object3D) {
    let playerDirection = new THREE.Vector3();
    obj.getWorldDirection( playerDirection );
    // 由于考虑重力，y轴永远置0
    playerDirection.y = 0;
    playerDirection.normalize();

    return playerDirection;
}

/**
 * 返回摄像头「看向」的侧向向量
 * @returns 获取player前进侧向的向量
 */
function getSideVector(obj: THREE.Object3D) {
    let playerDirection = new THREE.Vector3();
    obj.getWorldDirection( playerDirection );
    playerDirection.y = 0;
    playerDirection.normalize();
    playerDirection.cross( obj.up );

    return playerDirection;
}

/**
 * @param lookAt 指定的看向位置
 * @returns 获取方向向量
 */
function getDirectionVectorByLookAt(obj: THREE.Object3D, lookAt: THREE.Vector3): THREE.Vector3 {
    let playerDirection = new THREE.Vector3();
    let cameraProxy = obj.clone();
    cameraProxy.lookAt(lookAt);
    cameraProxy.getWorldDirection( playerDirection );
    // 由于考虑重力，y轴永远置0
    playerDirection.y = 0;
    playerDirection.normalize();

    return playerDirection;
}

/**
 * @returns 获取player看向的位置
 */
function getLookAtOfObject(obj: THREE.Object3D, distance: number = 1): THREE.Vector3 {
    const playerLookAt = new THREE.Vector3(0, 0, -distance);
    playerLookAt.applyQuaternion(obj.quaternion);
    playerLookAt.add(obj.position);
    return playerLookAt;
}

export { getForwardVector, getSideVector, getDirectionVectorByLookAt, getLookAtOfObject };
