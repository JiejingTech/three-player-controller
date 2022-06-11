/**
 * 有限状态机
 */
export class FiniteStateMachine {

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
}
