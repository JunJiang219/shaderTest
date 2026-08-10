import { _decorator, Component, Material, Node, UIRenderer } from 'cc';
const { ccclass, property, executeInEditMode } = _decorator;

@ccclass('Blur')
@executeInEditMode(true)
export class Blur extends Component {

    @property(Material)
    _customMaterial: Material = null;
    @property({type: Material, tooltip: "使用自定义材质"})
    public get customMaterial() : Material {
        return this._customMaterial;
    }
    
    public set customMaterial(v: Material) {
        this._customMaterial = v;
        this.syncMaterialToSelf();
        this.syncMaterialToChildren();      
    }

    @property
    _recursive: boolean = true;     // true: 影响自身+子节点  false: 只影响自身
    @property({ tooltip: "是否递归影响子节点" })
    public get recursive() : boolean {
        return this._recursive;
    }

    public set recursive(v: boolean) {
        this._recursive = v;
        this.syncMaterialToChildren();
    }

    @property
    _useEff: boolean = true;
    @property({ tooltip: "是否启用效果" })
    public get useEff() : boolean {
        return this._useEff;
    }

    public set useEff(v: boolean) {
        this._useEff = v;
        this.syncMaterialToSelf();
        this.syncMaterialToChildren();
    }

    /** Inspector 里改属性时会自动调用 */
    // onValidate() {
    //     this.syncMaterialToChildren();
    // }

    /** 运行时首次加载也同步一次 */
    start() {
        this.syncMaterialToSelf();
        this.syncMaterialToChildren();
    }

    /** 把 customMaterial 同步到自身 UIRenderer */
    private syncMaterialToSelf() {
        const uiRenderer = this.node.getComponent(UIRenderer)
        const applyMat = this._useEff ? this._customMaterial : null;
        if (uiRenderer) {
            uiRenderer.customMaterial = applyMat;
        }
    }

    /** 把 customMaterial 同步到子节点 UIRenderer */
    private syncMaterialToChildren() {
        const targets = this.collectAllChildren(this.node);
        const applyMat = (this._recursive && this._useEff) ? this.customMaterial : null;
        for (const node of targets) {
            const uiRenderer = node.getComponent(UIRenderer);
            if (uiRenderer) {
                uiRenderer.customMaterial = applyMat;
            }
        }
    }

    /** 递归收集所有子孙节点（不含自身） */
    private collectAllChildren(root: Node): Node[] {
        const result: Node[] = [];
        const walk = (node: Node) => {
            for (const child of node.children) {
                result.push(child);
                walk(child);
            }
        };
        walk(root);
        return result;
    }
}
