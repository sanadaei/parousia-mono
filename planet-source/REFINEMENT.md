# 補間・表面の向き・河川次数 0.3.1

更新日: 2026-10-09。第2段階の追加改善と、第3段階へ向けた基礎機能。湖・海・内陸終端湖の自動化は、利用者の指定で後続に回した。

検証節には0.2.2時点の記録を残す。0.3.1のC1水系接続は [AUDIT_RESPONSE_0.3.0.md](AUDIT_RESPONSE_0.3.0.md)、第3段階の全球接続は [GLOBAL_TERRAIN.md](GLOBAL_TERRAIN.md)、現在位置は [ROADMAP.md](ROADMAP.md)。

## C1基礎地形

```js
import { fromDynamicRegional } from './dynamic-regional.mjs';

const ground = fromDynamicRegional(world, {
  verticalDatum: 'dynamic-runtime-unspecified-local-zero',
  interpolation: 'bounded-hermite-c1@1',
  derivativeStepM: 1,
});
const point = ground.surfaceFrameAt(1234, 2345);
```

汎用入力では `SMOOTH_TERRAIN_SCHEMA`（地形@3）と `interpolation: 'bounded-hermite-c1@1'` を指定する。@3で補間方法を省略した場合もC1方式になる。@3は `bilinear@1` も受け入れる。従来の `TERRAIN_SCHEMA` は@2のままで、既定の双線形補間・保存同一性を維持する。@1/@2に補間方法を追加した入力は拒否する。

共有する頂点の一次導関数をminmodで抑え、混合導関数を0とした双三次Hermite補間。隣り合うパッチの値と一次導関数が一致する。Bezier制御点は、角の標高と、その角に接する二つの標高の凸結合になるため、パッチの標高は元の四隅の最小/最大の範囲に収まる。元の格子中心の標高も維持する。

最外セル中心から領域境界までは従来と同じ一定値延長。外側の頂点では法線方向の導関数を0にして、C1パッチから一定値延長へ接続する。外周の棚を除去する機能でも、隣接地域の勾配を接続する機能でもない。新しい微地形や計測情報は生成しない。二次導関数の連続性（C2）は保証しない。

0.3.1ではC1基礎地形に河道model・明示水位の水域・表流水格子を併用できる。地下水のみの入力は地表水の乾湿を未解決のまま返す。岸の検証にはC1パッチの六次線分極値、河道構築には切り取ったBezier制御点の包絡を使う。双線形の二次判定はC1へ流用しない。河床の三角形帯による変形は連続だが、河床を含む地表全体のC1化は後続事項。

```js
import { fromDynamicRegionalWater } from './dynamic-regional.mjs';
const rivers = fromDynamicRegionalWater(world, {
  verticalDatum: 'dynamic-runtime-unspecified-local-zero',
  interpolation: 'bounded-hermite-c1@1',
});
```

## 法線と曲率

`surfaceFrameAt(xM, yM)` は `sampleAt` の全値に次の値を加える。双線形地形・C1地形・河床を含むモデルのいずれでも、変更後の地表を参照する。

| 値 | 意味 |
|---|---|
| normal: {x, y, z} | zが上向きの単位法線。固定距離勾配から `(-gx,-gy,1)` を正規化 |
| curvature.xxPerM / yyPerM / xyPerM | 固定距離の二階差分。単位は1/m |
| curvature.meanPerM | 上向き法線の平均曲率の推定値。1/m |
| curvature.gaussianPerM2 | ガウス曲率の推定値。1/m² |
| curvature.stencilStepM | 世界に保存したderivativeStepM |
| curvatureStatus | `fixed-distance-estimate` または `unavailable-at-region-edge` |

領域境界からderivativeStepM未満の場所では、対称な二階差分を作れないため曲率はnull。法線は従来の片側差分から返す。数値範囲が有限値を超えるとエラーにする。新しい法線/曲率のゼロはJSONで表現が変わらないよう正の0に揃える。

曲率は固定距離の診断値。河道の折れ・C1パッチの継ぎ目の厳密な局所曲率、物理的な接触解法、全地表が滑らかであることの証明とは扱わない。既存のsampleAtの返却形は変えていない。

## 河川次数に応じた断面

```js
import { fromDynamicRegionalWater } from './dynamic-regional.mjs';

const rivers = fromDynamicRegionalWater(world, {
  verticalDatum: 'dynamic-runtime-unspecified-local-zero',
  channelSizing: {
    mode: 'strahler', widthFactor: 1.25, depthFactor: 1.12,
    maxHalfWidthM: 7.2, maxBankWidthM: 12, maxDepthM: 2.4,
  },
});
```

`connectSurfaceWater`にも同じchannelSizingを渡せる。省略時は従来の一律断面。指定時は、基準半幅/岸幅に `widthFactor ** (次数 - 1)`、基準深さに `depthFactor ** (次数 - 1)` を掛け、それぞれの上限で抑える。既定の倍率は1.25/1.12、上限は基準半幅/岸幅の4倍、深さの2倍。倍率は1以上、上限は基準寸法以上が必要。半幅1.8mは全幅3.6mを意味する。

合流では流入次数の最大値を取り、その最大値が2本以上あれば1増やす。元データの次数があるedgeは、その次数と継承計算した次数の大きい方を採用する。下流の補完edgeへ採用次数を引き継ぎ、途中で次数が減らないようにする。次の3値をedgeに保存する。

- sourceStrahlerOrder: 元edgeの次数。補完区間で元edgeがなければnull。
- derivedStrahlerOrder: 流入した採用次数から計算した値。
- strahlerOrder: 断面調整へ実際に使った値。

元データの次数は1～32の整数に限る。次数別調整は、nodeからの流出が1本以下の排水graphに限定する。分流を含むgraphは、流路の二重計数を避けるためこのオプションで拒否する。従来の静的graph契約全体を分流不可に変更したわけではない。

合流周辺の同水位区間は、接続edgeの最大の岸外幅から決める。幅の拡大に応じて基礎地形の上限制約も再評価する。帯の折れで幅を縮める既存処理は残り、実際の寸法をpoints、縮小比率をdiagnosticsに保存する。狭すぎる接続や矛盾した水位は拒否する。

次数は流量ではなく、この調整は校正済みの河川断面ではない。D8中心線、深い掘削、河床と元格子の流域所属の問題は残る。

## 0.2.2の検証記録

`npm test` は45件PASS。共通計算、元格子中心/標高範囲、両側からの一次導関数、解析的な平面法線と鞍形地形の曲率、保存/窓/LOD、次数伝播と上限、異常入力を検証した。旧@1地形と旧水系@1のworldId・353地点の互換検証も維持する。

`npm run verify:refinement` の実入力は旧world-a/world-b各96×72・120m。元の標高計13,824点が一致、パッチ内4,096点が四隅の範囲内、計336本の境界で両側導関数を比較した。最大の数値差は約5.90e-6（左右各0.001mの差分）。各ケースでLOD共通49地点・隣接窓31地点が一致し、計306地点の標高・勾配・法線・曲率がgeneratorを読み込まない別プロセスで一致した。記録は [examples/refinement/verification.json](examples/refinement/verification.json)。

`npm run verify:water` は従来6ケースと次数別の実地域2ケース、計8ケース。次数別だけで28合流点・16,616中心線参照点の水位逆転/水深違反0。実際の半幅はworld-aが1.8～2.8125m、world-bが1.8～2.25m。深さは1.2～1.50528m / 1.2～1.344m。今回の幅縮小は0件。次数別2ケースの保存再読込760地点、全8ケース1,737地点と道路診断が一致した。記録は [examples/surface-water/verification.json](examples/surface-water/verification.json)。

次数別の最大中心掘り込みは約13.20m / 13.39m。一律断面の約13.06m / 13.25mより増えており、掘削問題の修正完了とは扱わない。旧ソース2ファイルのハッシュは検証前後とPROVENANCEで一致。

0.2.2時点ではC1と河道の併用・全球接続は未検証だった。上記の45試験と8水系ケースは当時の記録で、参照する水系検証JSONは最新版へ更新される。

## 0.3.1の追加検証と現在位置

全69試験PASS。C1実地域の河川2件で28合流点・16,616点の水位逆転/水深違反0、760地点・98表面フレームの別プロセス再開が一致した。全10水系ケースの保存再開は計2,497地点が一致。最大中心掘り込みは約12.95m / 13.26mで、自然さの校正は残る。全球から局地への基礎接続と投影道路診断も実装し、現在は第3段階が進行中。全球水系/水際制約、掘削後の全地表のC1化、接地、描画・利用者受入、全seed/解像度と既存部品全試験は後続。
