export const _NAV_TOUCH_DOWN = 'navTouchDown';
export const _NAV_TOUCH_UP = 'navTouchUp';

function getOffset(el:Element) {
    // returns the offset of an element relative to the document
    const rect = el.getBoundingClientRect()
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop

    return {
        top: rect.top + scrollTop,
        left: rect.left + scrollLeft
    }
}

class NavTouchPad {
    private container:HTMLElement;
    private padSizeFunc: () => [THREE.Vector2, number, number];

    private padElement: HTMLElement;
    private region: HTMLElement;
    private handle: HTMLElement;

    private regionData: any = {};
    private handleData: any = {};

    constructor(container: HTMLElement, padSizeFunc: () => [THREE.Vector2, number, number]) {
        this.container = container
        this.padSizeFunc = padSizeFunc;

        this.padElement = document.createElement('div')
        this.padElement.classList.add('movement-pad')
        this.region = document.createElement('div')
        this.region.classList.add('region')
        this.handle = document.createElement('div')
        this.handle.classList.add('handle')
        this.region.appendChild(this.handle)
        this.padElement.append(this.region)
        this.container.append(this.padElement)

        this.initPadPosition();
        this.initEventListeners();
        this.resetHandlePosition()
    }

    private initPadPosition() {

        const [padCenter, _, padSize] = this.padSizeFunc();
        const leftGap = padCenter.x - padSize / 2;
        // 这里调整了下，让pad渲染位置正常
        const bottomGap = this.container.clientHeight - padCenter.y - padSize / 2;

        this.region.style.setProperty('width', padSize + 'px');
        this.region.style.setProperty('height', padSize + 'px');
        this.region.style.setProperty('border-radius', padSize / 2 + 'px')

        // Aligning pad position:
        this.padElement.style.top = this.container.getBoundingClientRect().top
        + this.container.getBoundingClientRect().height
        - this.region.offsetHeight - bottomGap + 'px'
        this.padElement.style.left = leftGap + 'px'

        this.regionData.width = this.region.offsetWidth
        this.regionData.height = this.region.offsetHeight
        this.regionData.position = {
            top: this.region.offsetTop, 
            left: this.region.offsetLeft
        }
        this.regionData.offset = getOffset(this.region)
        this.regionData.radius = this.regionData.width / 2
        this.regionData.centerX = this.regionData.position.left + this.regionData.radius
        this.regionData.centerY = this.regionData.position.top + this.regionData.radius

        this.handleData.width = this.handle.offsetWidth
        this.handleData.height = this.handle.offsetHeight
        this.handleData.radius = this.handleData.width / 2

        this.regionData.radius = this.regionData.width / 2 - this.handleData.radius
    }

    private initEventListeners() {
        document.addEventListener(_NAV_TOUCH_UP, () => this.resetHandlePosition())
        document.addEventListener(_NAV_TOUCH_DOWN, ((event: CustomEvent<THREE.Vector2>) => {
            this.handle.style.opacity = '1.0'
            const touchPos = event.detail;
            this.updateHandle(touchPos.x, touchPos.y);
        }) as EventListener)
    }

    public handleWindowResize() {
        if (this.padElement) {
            this.padElement.remove();
        }
        this.padElement = document.createElement('div')
        this.padElement.classList.add('movement-pad')
        this.region = document.createElement('div')
        this.region.classList.add('region')
        this.handle = document.createElement('div')
        this.handle.classList.add('handle')
        this.region.appendChild(this.handle)
        this.padElement.append(this.region)
        this.container.append(this.padElement)

        this.initPadPosition();
        this.initEventListeners();
        this.resetHandlePosition();
    }

    /**
     * 更新控制面板handle位置
     * @param pageX handle位置
     * @param pageY handle位置
     */
    private updateHandle(pageX: number, pageY: number) {
        let newLeft = (pageX - this.regionData.offset.left)
        let newTop = (pageY - this.regionData.offset.top)

        // If handle reaches the pad boundaries.
        let distance = Math.pow(this.regionData.centerX - newLeft, 2) + Math.pow(this.regionData.centerY - newTop, 2)
        if (distance > Math.pow(this.regionData.radius, 2)) {
            let angle = Math.atan2((newTop - this.regionData.centerY), (newLeft - this.regionData.centerX))
            newLeft = (Math.cos(angle) * this.regionData.radius) + this.regionData.centerX
            newTop = (Math.sin(angle) * this.regionData.radius) + this.regionData.centerY
        }
        newTop = Math.round(newTop * 10) / 10
        newLeft = Math.round(newLeft * 10) / 10

        this.handle.style.top = newTop - this.handleData.radius + 'px'
        this.handle.style.left = newLeft - this.handleData.radius + 'px'

        // event and data for handling camera movement
        let deltaX = this.regionData.centerX - newLeft
        let deltaY = this.regionData.centerY - newTop

        // 将handler位置(x,y)正则化到 -2 和 2 之间
        deltaX = -2 + (2 + 2) * (deltaX - (-this.regionData.radius)) / (this.regionData.radius - (-this.regionData.radius))
        deltaY = -2 + (2 + 2) * (deltaY - (-this.regionData.radius)) / (this.regionData.radius - (-this.regionData.radius))
        deltaX = Math.round(deltaX * 10) / 10
        deltaY = Math.round(deltaY * 10) / 10
    }

    /**
     * 重置Nav控制面板handler位置
     */
    private resetHandlePosition() {
        this.handle.style.top = this.regionData.centerY - this.handleData.radius + 'px'
        this.handle.style.left = this.regionData.centerX - this.handleData.radius + 'px'
        this.handle.style.opacity = '0.1'
    }
}


export { NavTouchPad }
