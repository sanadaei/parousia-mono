# L0: 惑星の骨格とレビュー

2026-10-12。新規生成向け `earthlike-l0@1`。既存保存世界は再生成・移行しない。

## 今回の完成範囲

- seedから全球の海陸・低地・山地の粗い分布を作る。
- 全球の既存排水グラフ、静的湖、主要河川、気温・降水・バイオームへ接続する。
- 表示LODで生成条件を変更しない。生成時の格子解像度は保存された世界の条件。
- 下位が参照できる粗い地域条件を返す。局所地形・小川・集落の座標はここで決めない。
- 複数seedの実データを画像・軽量HTMLでレビュー可能にする。

これは視覚レビューに出せる実装範囲であり、人間による「自然さ」の合格を意味しない。
L1の隣接地域制約ソルバー、全球から近景までの新接続方式の完成ではない。

## 変更理由

旧標高式は大陸性の値に8500mを掛けていたため、海岸から離れるほど
大陸内部全体が高くなりやすかった。さらに緯度冷却式は中緯度で強く、
保存例 planet-1 は全球面積の約23.1%が極寒・裸地分類だった。

新方式は、海陸を決める場、低地の起伏、山地帯、隆起の強さを分離する。
面積重み付きの閾値で陸の目標比率を指定し、広い低地と限られた高地を両立する。
標高・海岸への接続は連続的なフェードで行う。緯度による冷却を緩め、
亜熱帯の下降気流に対応する乾燥傾向を簡略式へ加えた。

これらの係数はゲーム向けの調整値であり、論文から導いた物理定数ではない。
NOAAの標高分布は陸の平均標高約847mなどの比較根拠、NASA/NOAAの循環資料は
赤道多雨・亜熱帯少雨の構造の根拠として使用した。地球の比率の完全再現は要求しない。

## 水域についての重要な限定

新規L0プロファイルの湖の初期値は、底から越流水位までの高さの20%。
旧設定は100%。これは明示した静的シナリオであり、湖面蒸発・流入・漏水の
平衡を解いた結果ではない。既存の `--lake-fill` で上書きできる。
この設定の湖は閉鎖湖扱いとなり、湿潤地域の越流湖の自動選別は未実装。
大陸内部の全窪地を満水にして巨大湖が広がる傾向を抑える暫定条件であって、
水文学の完成を主張しない。寒冷分類も氷床の物理モデルではない。

海は最大の連結した海面下領域を海の水源とする既存方式。
孤立した海面下盆地は内陸水域として扱われるため、指定の海面上陸地比率と、
実際の海・湖・乾いた陸地の比率は一致しないことがある。

## 下位レイヤーとの境界

`describeL0Region(snapshot, climate, cellIndices)` は、同一世界の一意なセル集合に
対し、球半径・基準面・海面、粗い標高/気温/降水の範囲、バイオーム別面積を返す。
気候のworldId不一致や重複セルを拒否する。入力を変更しない。

粗い格子の最大・最小は、全ての局所点に強制する標高の上下限ではない。
海岸の細部、小流路、植生の局所混在、集落・道路の位置は未確定として返す。
確定済みの隣接境界・受け側の水域は維持し、集落より先に地形を決める。
このAPIは親条件の記述であり、L1の生成・制約解決を代行していない。

## 利用と互換性

- 通常の `scripts/generate-planet.mjs` とUIからの新規生成は新L0を使う。
- 生成APIの新規保存先の版を更新。古い生成先と衝突せず、保存世界はそのまま開ける。
- 低レベル `generatePlanet()` は互換性のため既定が legacy。
  新方式は `macroProfile: 'earthlike-l0@1'` を指定する。
- CLIで旧方式を明示するには `--macro-profile=legacy`。
- 新L0を持つsnapshotは気候モデル `earthlike-zonal@2` を選ぶ。旧snapshotは従来式。

## 再現と画像の位置づけ

```sh
node --max-old-space-size=256 scripts/audit-l0.mjs reports/l0-review
node scripts/build-l0-review.mjs reports/l0-review reports/planet-l0-review.html
```

後者をブラウザで開くと、4seedと標高・気温・降水・バイオームを切り替えられる。
これは実生成データの診断画面であり、3Dゲーム画面ではない。
全球図は同一の128×64格子と同じ凡例で比較する。極付近の面積を過大評価しないよう
統計はセル面積で重み付けする。詳細を一度に生成する必要はない。

4seedの実測値は `reports/l0-review-2026-10-12.json`。
乾いた陸地の平均標高は約560–871m、1000m未満の海面上陸地は乾いた陸地の
約72–83%。砂漠・湿潤林・草原・寒帯が出ることを確認した。
通常の生成器の128×64実行でも新プロファイル・気候・河川への接続を確認。

全1141テスト PASS / 0 fail / 0 skip（単一worker、256MiBヒープ）。
ビルド検証は140 core・30 legacy aliases・57 globe modules。
ブラウザスクリーンショットは未取得。クラウド側からローカル配信先への到達と
データURL表示に制限があるため、実生成データの診断PNGを別途共有した。
HTMLの構文・埋込データは確認済みだが、ブラウザ操作の受入完了ではない。

## 参考

- NOAA ETOPO1 hypsographic curve:
  https://www.ncei.noaa.gov/sites/g/files/anmtlf171/files/2023-01/Hypsographic%20Curve%20of%20Earth%E2%80%99s%20Surface%20from%20ETOPO1.pdf
- NOAA global atmospheric circulation:
  https://www.noaa.gov/jetstream/global/global-atmospheric-circulations
- NASA precipitation / vegetation comparison:
  https://science.nasa.gov/earth/earth-observatory/global-maps/total-rainfall-vegetation/
- NASA Blue Marble topographic maps:
  https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography/

## 同じ地形で初期数値だけを変える比較（2026-10-12追補）

`generateClimate(snapshot, {temperatureOffsetC, precipitationScale})` に共通の数値入力を追加。
既定値は0℃・1倍。指定しなければ以前の気候データとIDを完全に維持する。
気温補正は月別気温に、降水倍率は月別降水計算に入り、同一の分類・土壌水分・
積雪融雪・潜在流出計算を通る。砂漠/氷期専用の分岐はない。
両値は `snapshot.references.climateForcing` に記録して読み出すことも可能。
これは指定された気候平年値の条件であり、日射・CO2・海流の応答を解くものではない。

実験は、先ほどの新L0通常生成器によるplanet-1の同一保存snapshotを4回参照した。
入力全体のハッシュが前後で不変であること、全ケースの参照元が同一であることを検証。
旧の基準気候JSONとのdeep equalityも確認した。地形・海岸・湖面・既存河川形状は不変。

| 条件 | 気温補正 | 降水倍率 | 陸地の砂漠 | 陸地の通年氷点下 | 陸地のツンドラ |
|---|---:|---:|---:|---:|---:|
| 基準 | 0℃ | 1.0 | 14.8% | 10.6% | 10.5% |
| 温暖・乾燥 | +8℃ | 0.08 | 83.6% | 5.9% | 6.8% |
| 寒冷期 | −6℃ | 0.8 | 14.5% | 16.6% | 12.6% |
| 強い寒冷 | −18℃ | 0.6 | 7.5% | 32.0% | 34.6% |

分母は海・湖を除いた陸地の面積。格子数ではなく面積で重み付けした。
降水は気温にも依存するため、気温補正も同時に変えると、平均降水量は倍率だけの
比例にはならない。気温を固定した降水倍率単独の比例は丸め誤差内でテストした。

−6℃は最終氷期最盛期の全球平均寒冷化約−6.1℃という研究を目安にしただけで、
実際の氷期の空間分布の再現ではない。降水倍率・強寒冷条件は比較用の仮定。
https://www.nature.com/articles/s41586-020-2617-x

制限: 氷床・氷河の流れ・海氷・氷河侵食・海面低下・反射率フィードバックは未実装。
「極寒」分類を氷河生成と呼ばない。海が青いままなのは海氷がないため。
潜在流出は再計算されるが、既存河川形状や湖水位はこの比較では作り直さない。
したがって、砂漠惑星・寒冷惑星の環境分布は初期値で変えられるが、
それらの水文・氷河まで完全に応答する惑星モデルの完成ではない。

再現:
```sh
node --max-old-space-size=256 scripts/compare-climate-scenarios.mjs reports/l0-scenarios
# 通常生成済みのsnapshot、または {snapshot: ...} を渡す場合:
node --max-old-space-size=256 scripts/compare-climate-scenarios.mjs reports/l0-scenarios path/to/snapshot.json
```

今回は後者を使用。前者は軽量L0監査用の同一地形から比較する。
入力不変・既定値互換・気温補正・降水/流出接続・無降雨・値域拒否・分類変化の
回帰テストを追加。実測は `reports/climate-scenarios-2026-10-12.json`。

追補後の最終検証: 全1147件 PASS / 0 fail / 0 skip、ビルド成功。
同一snapshotでの4条件比較、以前の保存済み基準気候との一致も別途確認した。
通常UIの気候入力欄は今回の対象外。APIまたは比較スクリプトから値を渡す。

## 人口・集落予算の分布のみレイヤー（2026-10-13追補）

後続段階で人口正本を@2へ更新し、保存する規模仮定と、集落個数に結び付いた人数の継承を追加した。下記の数値例は前段の記録。現在のL1→L2候補、農地需要、再現手順は [L2_SETTLEMENT_HANDOFF](L2_SETTLEMENT_HANDOFF.md) を参照。

`src/core/settlement-distribution.mjs` を追加した。全球の人口・村町都市数を
「分布のみ」として保存し、L1の細かい格子へ整数予算を失わず受け渡す。家・村の
正確な座標や道路は全世界分生成しない。GUIはこのデータを使う。

公開API（純粋関数、入力は変更しない）:

- `createL0SettlementDistribution(snapshot, climate, population)`:
  既存 `planAgriculturePopulation` を人口の正本として再利用し、各L0セルの
  7予算（population / rural / town / city 人口、villages / towns / cities 数）を
  そのまま継承する。人口の二重計算や交易・灌漑・歴史シミュレーションはしない。
  海・湖セルは0。
- `validateSettlementDistribution(distribution)`:
  版・内容ハッシュ、`status:'distribution-only'`、7予算の整数・非負・上限、
  人の3種の和=population、人口と対応する集落数の整合、海・湖への配分禁止、
  格子一致を検査する。改ざんされたid、別世界/別気候/別格子は拒否する。
  さらに宣言された集計（`totals`の全7項目と`populatedCells`）と`summary`
  （要求=支持+未配置、L0支持=実セル総人口、L1支持=実セル総人口+未配分総人口、
  村町都市数・人口セル数は実配分と一致、L1`unallocatedPopulation`は再計算値と
  一致）を実セルから再計算して照合する。L1の`unallocated`は`parentCells`を
  配列として検査し、7列と`populatedCells`・`parentCells`件数を実配列から
  再計算して照合する（空レコードでも全7項目0を要求）。ハッシュは構造整合の
  代替ではない。人口正本の`totals`が矛盾する場合も`createL0SettlementDistribution`
  が拒否する。
- `describeSettlementDistribution(distribution, cellIndices)`:
  一意なセル集合の7予算を集計して返す。
- `refineSettlementDistribution(distribution, options)`:
  options は `sourceWorldId` / `climateId` / `sourceLayerId` / `grid` /
  `parentCell` / `cellAreaM2` / `landMask` / `lakeFillDepthM` / `suitability`。
  親セルごとに子をまとめ、実面積と相対適性の重みで largest-remainder/BigInt
  整数配分し、7予算を厳密保存する。各人口種の集落数と人口を結び付け、人口だけ
  あるのに集落数0という矛盾を作らない。親に予算があるのに適地が無い場合は、
  その親の7予算を `unallocated` として明示的に残す（親=全子+未配分、全7項目）。
  このスライスでは L0 親専用であり、L1 を再配分することは明示的に拒否する
  （L1->L2 の一般化は今回行わない）。`createL1BroadRegion` と `describeL0Region`
  の任意の親分布も `layer:'L0'` を照合する。

保存形式は版と内容ハッシュ（`id`）、`sourceWorldId`、`populationId`、
`climateId`、L1は `sourceLayerId` と `parentDistributionId`、`grid`、
7予算、`interpretation`/`assumptions`/`limitations` を持つ。格子データは
コンパクトな列配列 `fields`（7予算 + `wet` + 量子化 `suitability`）にし、
大量の集落オブジェクトや座標を作らない。

接続:

- `describeL0Region(snapshot, climate, cellIndices, settlementDistribution)` は
  任意の第4引数を受け取り、同一世界・格子・気候を検査して、指定セルの人口・
  村町都市予算を `settlementBudget` として返す。渡さない呼出しは従来どおり。
- `createL1BroadRegion` は `parent.settlementDistribution` がある場合だけ
  L1の `settlementDistribution` を生成して返す。L1 layerId の内容に親
  distribution IDを含めるため、同じ地形でも人口予算が違えばL1 idは異なる。
  地形・水系・気候の数値は人口の有無で完全に一致する（idだけが変わる）。
- `scripts/experiments/build-l1-broad-region.mjs` の保存条件にも親 distribution
  IDを含める。24MiB上限と通常の16MiBローカル枠は変更しない。
- `scripts/audit-l0.mjs` の `auditL0(seed, options)` は `targetPopulation`
  （既定1億）と人口シナリオを受け取り、人口正本とL0 settlementDistribution を
  返す。summaryに要求/支持/未配置人口、村町都市数、人口のあるセル数を追加する。
  表面適性はL0データから得るため全家屋/道路生成は呼ばない。

再現CLI:

`npm run l0:baseline` で下記の実データと単独で開ける
`reports/l0-settlement-baseline/review.html`（惑星の人口・集落分布）を作成する。
L0/L1、人口密度・村・町・都市の密度を共通尺度で比較でき、区画をクリック・
タップまたは矢印キーで選ぶと予定数と親予算・配分・未配分を確認できる。
家・街・道路や正確な集落位置を生成する画面ではない。

保存済みの3つのJSONから表示だけを作り直す場合:

```sh
node scripts/build-settlement-distribution-review.mjs reports/l0-settlement-baseline
```

```sh
node --max-old-space-size=256 scripts/build-l0-settlement-baseline.mjs \
  reports/l0-settlement-baseline --seed=planet-1 --population=100000000 \
  --columns=128 --rows=64 --levels=2
```

`auditL0 -> createL0ResolutionSeries -> createL1BroadRegion` を直列で行い、
`l0.json` / `l1.json` / `summary.json` を保存し、読戻しの同一性・保存サイズ・
全予算保存を検査する。`examples/planet/generated`、`fixtures`、参照DEMは
上書きしない。実測（planet-1、1億人、128×64 L0）:

- L1 512×256（`--levels=3`）: L1 JSON 19,666,679 bytes ≈ 18.75 MiB、
  24MiBストアの保存レコード 19,667,076 bytes。24MiB未満。
- L1 256×128（`--levels=2`、既定）: L1 JSON 4,932,143 bytes ≈ 4.70 MiB。
  全予算保存。適地の無いL0親1件が未配分（re: 101,168人）として明示的に残った。

L0/L1予算はGUIの色分けとL2以降への受渡しに使う。正確な都市等の立地点と
道路は引き続き未確定であり、`coarse suitability` は相対重みで、細かい食料
収容力の保証ではない。

## population zones との用途境界

既存 `src/core/population-zones.mjs` は、参照した枝だけを球面等面積で4分割し、
`PopulationZoneHierarchy` と materializer を通じて**確定した集落位置**を
保存する（`surveyPopulationZoneWeights` の疎な調査を含む）。用途は「参照時の
局所確定」。

今回の `settlement-distribution.mjs` は、全球L0/L1の**分布のみ**を持ち、
座標・家・道路を一切作らない。用途は「GUIの広域色分け」と「上位から下位への
妥当な整数予算の受け渡し」。人口は `planAgriculturePopulation` の単一正本を
共有し、二重計算しない。集落位置を確定するのは population zones 側の役割で、
両者を同じ確定結果として二重に配置しない。
