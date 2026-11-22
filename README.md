# 犀皮漆髹饰推演系统

浏览器内的犀皮漆工艺数字孪生：参数化胎体、种子化起底、逐层髹漆物理推演、实时打磨与纹样比对。
纯 TypeScript + WebGL2 手写着色器，工艺档案持久化在 IndexedDB，无后端依赖。

## 运行

```bash
npm install
npm run dev      # 开发服务器
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览构建产物
```

## 测试

```bash
# 推演内核：确定性校验和、体积守恒、物理性质（Node 直接运行，无需浏览器）
node --experimental-strip-types tests/sim_test.ts

# 浏览器冒烟：六路由遍历、真实鼠标打磨、一致性自检、控制台错误捕获
# 需本机装有 Chrome 与 Python playwright
python tests/browser_test.py
```

## 架构

```
src/
  sim/            纯计算层，不碰 DOM，可在 Node 独立测试
    types.ts        领域模型与持久化结构
    rng.ts          mulberry32 种子随机，所有随机行为只依赖显式种子
    grid.ts         256×256 参数域网格（极域/矩形域），传导系数与面积权重
    body.ts         盘/盒/碗参数化胎体 + OBJ 光栅化
    bump.ts         麻籽/指捺凸点场，三种分布，空间哈希加速
    layers.ts       髹漆层通量扩散（凸顶流薄、凹处积厚），固定 10 次迭代
    grind.ts        打磨切削场、逐笔重放、FNV-1a 校验和
    analysis.ts     色块占比、纹路密度、参考图中位切分聚类
    db.ts           IndexedDB 仓储
    presets.ts      4 件预置教学作品
  gl/             WebGL2 渲染层
    shaders.ts      顶点位移/法线/四种渲染模式的 GLSL
    renderer.ts     R32F 高度纹理、纹理数组、侧壁底盖独立网格
    orbit.ts        轨道相机 + 参数域射线拾取
  ui/             DOM 页面与共享工作台
  state/          全局 store 与 hash 路由
```

## 确定性如何保证

- 凸点位置、大小全部走 mulberry32 种子 PRNG，同种子同参数必然同分布
- 漆层流动是固定迭代次数的通量扩散，运算顺序、Float32 精度、循环边界全部写死
- 打磨记录为有序 stroke 序列，回放等于从零按 order 重放，无系统时间/随机输入
- 打磨页内置「一致性自检」：两次独立深拷贝重建后比对 ground 场 FNV-1a 校验和
- 内核测试覆盖增量推演 vs 从零重放、深拷贝输入、幂等重放、矩形/极域双场景

## 关键物理参数

| 参数 | 含义 | 可调位置 |
| --- | --- | --- |
| flow | 漆层流动系数，控制凸顶到凹处的扩散速率 | 髹漆层页 |
| shrinkage | 干燥收缩率，湿漆厚度乘 (1-shrinkage) 得干漆 | 髹漆层页 |
| cutRate | 磨具单位轨迹切削深度 | 打磨页磨具选择 |
| pressure | 下压力度 0~1，实际切削 = cutRate×(0.35+0.9×pressure) | 打磨页滑块 |
| THIN_WARN | 剩漆 0.12mm 触发热力图预警 | sim/grind.ts |

## 性能

- 打磨只更新一张 256×256 R32F ground 纹理（64KB 上传），顶点位移与法线全在 GPU
- 工作面约 13 万三角形，单 draw call；侧壁底盖独立 VAO 再一次 draw call
- 帧循环只跑着色器，无 CPU 网格重建，40cm 盘子边磨边看保持交互帧率
