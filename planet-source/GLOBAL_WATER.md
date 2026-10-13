# 全球場上の明示水系（0.3.4、第3段階）

更新日: 2026-10-09。一つの確定した球面地形に、呼び出し側が明示した投影範囲・河川graph・水域水位を重ねる。全球場を粗い地域格子へ置き換えず、既存の詳細化を直接参照する。湖・海・内陸終端湖の自動化は利用者の指定で保留。

0.3.3の二重コンパイル除去・適応参照と旧保存互換の証拠は [AUDIT_RESPONSE_0.3.2.md](AUDIT_RESPONSE_0.3.2.md)。格子を必要とする利用側への別地域版の書き出しは [PROJECTED_CANONICAL.md](PROJECTED_CANONICAL.md)。

0.3.4では独立した複数chartを一つの全球水系@2へ保存できる。外岸の滑らかな接続・自己重複の拒否・新しい詳細化に対する上下限を追加した。仕様と実入力の同時構築/保存再開は [AUDIT_RESPONSE_0.3.3.md](AUDIT_RESPONSE_0.3.3.md)。

## 使用と範囲

```js
import { connectGlobalSurfaceWater, connectProjectedSurfaceWater } from './global-water.mjs';
import { createProjectedTerrainView, serializeGlobalTerrain, restoreGlobalTerrain } from './global-terrain.mjs';

// baseGlobal は生成済みの minimal-world-global-terrain@1。
const waterWorld = connectGlobalSurfaceWater(baseGlobal, {
  centerLatDeg: 0, centerLonDeg: 180,
  bounds: { minXM: -6000, minYM: -6000, maxXM: 6000, maxYM: 6000 },
  verticalDatum: baseGlobal.frame.verticalDatum, // 水位もこの基準のメートル値
  riverGraph: {
    nodes: [{ id: 'source', xM: 0, yM: -1000 }, { id: 'out', xM: 0, yM: 1000 }],
    edges: [{ id: 'river', from: 'source', to: 'out',
      points: [{ xM: 0, yM: -1000 }, { xM: 0, yM: 1000 }] }],
  },
  waterBodies: [], // 必要なら既存の単純多角形・明示水位の契約で指定
  groundBoundsStepM: 5, // 既定20m。1～1000m
  maxCenterIncisionM: 5, // 既定5m。超えた入力は拒否
});
const region = createProjectedTerrainView(waterWorld, { centerLatDeg: 0, centerLonDeg: 180 });
const point = region.surfaceFrameAt(0, 0);
const reopened = restoreGlobalTerrain(serializeGlobalTerrain(waterWorld));

// 既存の投影viewを入口にする場合:
// const wetView = connectProjectedSurfaceWater(baseView, { verticalDatum, riverGraph, waterBodies });
```

この例のgraphは呼び出し側が指定する。元のgeography-liteの河川を自動抽出した例ではない。地形・岸・水位・掘削量の制約を満たす入力が必要で、任意の地形上の任意graphが受理される保証はない。parametersと任意のStrahler断面は有限地域と共通のprofile solverを使う。

connectGlobalSurfaceWaterの全球水系@1は一つの明示chartを保存し、重ね追加を拒否する。複数の独立chartはconnectGlobalSurfaceWaterCharts(baseGlobal,{charts})で全球水系@2として構築する。1～16chart、一意のidと証明可能な離れた範囲を要する。同じ投影では矩形、異なる投影では矩形を含む球面円で分離を検査し、差分距離2倍超の余裕を必要とする。重複範囲・chartを跨ぐ接続は拒否する。center・projection・bounds・chart集合の変更は別worldId。同じ水系worldのviewならworldIdは共通で、regionIdは投影と範囲ごとに異なる。

水の既知範囲はchart.boundsの内部。地点のhydrologyStatusはmodeled、乾いた地点のwaterDepthMは0、水がある地点は水面−変更後地表の水深を返す。範囲外はunresolved・水深nullで、基礎地表をそのまま返す。world/view全体のhydrologyStatusはpartially-modeled。指定範囲の外まで乾燥が確認されたという意味はない。

河道の岸・端部を含む掘削支持範囲はchart境界より内側に収める。境界での河床切断とregional-boundary outletを拒否し、必要なら範囲を広げる。湖・海の探索領域は有限地域と同じ境界検査を使う。内部の濡れた探索境界は拒否する。chart外周を探索境界にする場合は、水系の既知範囲を切り出す契約であり、その線を自然な岸だとは扱わない。

## 地表下限と掘削量の検査

全球地表は周期Hermite・polar cap・固定詳細化の合成で、有限地域の六次線分多項式にはならない。そのため、現在の解析式から求めた保守的な勾配上限Lと、全球場を直接読む有限間隔の参照を併用する。地形の再格子化や追加ノイズは行わない。

Hermiteの一次導関数はパッチ全体のBezier制御点から上限を求め、球面の経度・緯度の距離へ換算する。詳細化の境界係数・振幅予算・3Dノイズの勾配と、極域capの勾配も加える。矩形では標本中心から最遠点までの距離、線分では標本間隔の半分にLを掛け、丸めの余裕を加減する。線形水位を引いた線分には水位勾配も加える。方式と希望step/L/丸め量はgroundAnalysisに保存する。

新しいanchored-spherical-residual-bands@2では、Cartesianノイズと元中心のアンカー補間の勾配上限を加える。旧方式の四隅の範囲制約は使わず、総振幅の契約に従って同じ地表を検査する。

新規構築の方式は`spherical-lipschitz-adaptive-probes@2`。矩形/線分の参照数が262,144を超える場合は間隔を広げ、実際の間隔で上下限の余裕を計算する。評価結果に参照数・有効間隔・調整有無を返す。groundBoundsStepMは希望間隔であり、広域では有効間隔がそれを上回る。旧`spherical-lipschitz-probes@1`のsnapshotは元の固定間隔・予算拒否の契約で復元する。

この下限でprofileの上限、岸、水域探索境界を検査する。保守的な包絡なので、実際には成立する入力を拒否することがある。groundBoundsStepMを小さくすると予算内では包絡の余裕が減るが、参照の作業量は増える。予算調整後の粗い包絡で岸や掘削上限を証明できない場合も拒否する。実測地形の精度や、任意の未知補間式への保証ではない。

maxCenterIncisionMは、**profile中心線に沿う基礎地表と設計河床の差**の上限。頂点間も勾配上限を使って検査し、centerIncisionUpperBoundMとして保存する。復元時に再計算し、指定上限と保存値の整合を再検証する。水域が既に深い場所では河床を持ち上げない。岸全体の掘削量・体積・施工費を制限する機能ではなく、既存の有限地域builderにはこの追加ゲートを適用していない。

## 保存と道路診断

snapshotはminimal-world-global-water-terrain@1で、変更前の全球snapshot、明示chart、fitted profileと水域、検査条件を含む。worldIdはこれら全体から求める。復元はrestoreGlobalTerrain、投影viewはrestoreProjectedTerrainView。幅の再調整やgeneratorの起動は行わず、同じ直接参照場から空間索引を再構築する。元のsourceWorldId、元セル・流域・流出口・地物IDは維持する。掘削後の流域を再計算した値ではない。

新規構築は水系の`strip-with-smooth-banks@4`を保存する。旧construction@1/@2/@3と固定間隔の解析方式も元のworldId・値で読める。構築時は幅調整を含むコンパイルを一度行い、その検証済みメッシュをsamplerへ渡す。復元時も保存幅を一度コンパイルして掘削上限と支持範囲を再検証する。頂点の掘削診断は線分上限の参照中に収集し、両方の条件を維持する。

複数chartのsnapshotはminimal-world-global-water-terrain@2で、一つのbaseとid順に並べたwaterChartsを保存する。地点にwaterChartIdを返し、waterSourceIdsはchart ID / source IDをURL符号化して区別する。world/viewの復元APIは単一chartと共通。

河道を構築した投影と同じ座標基底のviewでは、traceSurfaceSegmentが河道メッシュ・水域探索境界・既知範囲境界のイベントと中点を加える。粗い固定間隔の間にある細い川も診断できる。中心・半径が違う投影では固定間隔と中点だけを使い、メッシュの厳密な交差イベントは追加しない。返却precisionで区別する。湖岸自体の厳密な交点解法ではない。

inspectRoadCrossingsにはroadsを明示する。橋高の照合にはworldIdとregionIdが必要。未知水深を乾いた進入路へ変えず、未知標本数を記録する。道路全幅・橋台・構造・生成や接地は第4段階のまま。

## 検証と現在位置

`npm run verify:global-water`は全107試験、保存済みgeography-lite実入力audit-a/audit-bの8投影、明示した人工湖1例を直列に確認する。子プロセス256MiB heap・30秒上限。現在版の出力先はexamples/global-water/0.3.4。以下は保持した0.3.3の [examples/global-water/0.3.3/verification.json](examples/global-water/0.3.3/verification.json) の結果。元の全球入力は保存済みのexamples/globalを読み、生成器を再実行しない。旧版の全球水系計18snapshotはverify:stage3で元worldIdと値の一致を確認した。

- 実入力各4投影: 日付変更線、元格子の経度継ぎ目、北極、南極。各ケースに独立した呼び出し側指定の合流graphを接続し、計8合流点・4,144中心線参照点で水位逆転/水深違反0、元流域を保持。
- 各ケース49点のLOD一致・31点の隣接窓一致、別中心の投影でも標高・水深・流域を照合。同じchart投影で8道路交差を検出。
- 実入力の掘削上限は全ケース5m以内。最大の保守的な中心線上限は約3.240537m。これを自然な全球河川網や掘削の物理校正の合格とは扱わない。
- 実入力の696表面フレーム、人工湖の202表面フレーム、全球標本・道路診断をgeneratorなしの別プロセスで全値照合。
- 人工湖は指定水位50mと窪地との交線で乾湿が変わり、内部の乾いた探索境界に達する。元の地表を変更しない。大きな人工標高差を使う機械検証用で、自然な湖を発見した例ではない。
- 元ソース8ファイルと、元の全球snapshot2件のSHA-256は試験前後で一致。有限地域の既存10ケースも2,497地点・98C1表面フレームと道路診断の回帰を確認した。

0.3.4の同時構築は [examples/audit-0.3.3/0.3.4/verification.json](examples/audit-0.3.3/0.3.4/verification.json)。新しい詳細化を持つ実全球2世界に各4chartを接続し、4,144中心線参照点、672表面フレーム・全球標本・線分/道路診断を確認した。全chartが指定掘削上限5m以内、最大約2.658407m。同じ投影の独立2chartを跨ぐ道路の2交差も単体試験で検出した。

現在は**第3段階が進行中**。独立した複数chart、指定水位・水際制約、保存復元、中心線掘削上限、道路診断まで進んだ。chartを跨ぐ河川と重複範囲の水際、詳細化後の排水、元の継ぎ目/地名重心、河床・岸全体のC1化と自然さは残る。水域自動化は保留。第4段階の接地・橋生成、第5段階の実画面・利用者受入は未着手。
