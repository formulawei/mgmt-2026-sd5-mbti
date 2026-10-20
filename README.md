# MGMT 2026｜SD5 人格特質自我診斷（MBTI）

學生把上週紙本 32 題的 a／b 勾選輸入網頁，全部填完、核對並送出後，才會看到自己的四項結果、轉換過程與 16 型解讀。所有個人結果送到老師的 Google 試算表（GAS 後台），由後台彙整全班 16 型分布、班級代表型與 2017 年以來的趨勢。學生端看不到任何班級資料。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 學生端網頁，放在 GitHub Pages。單一檔案，CSS 與 JavaScript 內嵌。 |
| `gas/Code.gs` | Apps Script 後台：收件、伺服器端重新計分、同學號去重、彙整、歷年資料。 |
| `gas/Dashboard.html` | 老師專用的班級彙整與趨勢頁（GAS 網頁或試算表對話框）。 |
| `tests/test_model.js` | 計分規則與後台邏輯測試（只需 Node.js）。 |
| `tests/test_e2e.js` | 學生端全流程與後台畫面測試（需 Playwright）。 |
| `tests/test_integration.js` | 模擬 GitHub Pages 與 GAS（含 302 重新導向）的多人整合測試。 |
| `data/MBTI_Class_Results_2017P_fixed.xlsx` | 歷年原始資料，2017 年 P 已更正為 27。 |

## 目前部署狀態（2026-10-20）

- 學生網址：https://formulawei.github.io/mgmt-2026-sd5-mbti/
- GAS 後台：綁定於 Google 試算表「MGMT2026_SD5_MBTI」，Apps Script 專案「MGMT2026_SD5_MBTI_Backend」，網頁應用程式部署「SD5 v1」，目前為第 2 版。
- 老師後台網址含金鑰，不放在本 repo；請從試算表選單「SD5 後台 → 顯示後台網址與金鑰」取得。

## 計分規則（SD5 第 3 頁）

每個構面 8 題，圈選數較高者為該項結果。平手時依講義不計入特定題目再比：I／E 第 11 題、S／N 第 16 題、T／F 第 24 題、J／P 第 23 題。前端與後端使用同一份轉換表，後端會用原始答案重新計分，前端結果與後端不一致時會提示學生通知助教。

## 部署步驟

### 一、建立 GAS 後台（約 5 分鐘）

1. 新建一份 Google 試算表，例如「MGMT2026_SD5_MBTI」。
2. 擴充功能 → Apps Script。把 `gas/Code.gs` 貼進 `Code.gs`；新增 HTML 檔，命名為 `Dashboard`（不含 .html），貼入 `gas/Dashboard.html`。
3. 儲存後回到試算表重新整理，選單會出現「SD5 後台」→ 執行「① 初始化」。第一次會要求授權。初始化會建立 `Responses`、`History`（已預載 2017–2025）與 `Summary` 三個工作表，並產生老師金鑰。
4. Apps Script 右上「部署」→「新增部署作業」→ 類型「網頁應用程式」：執行身分「我」，存取權「所有人」。
5. 回試算表執行「SD5 後台 → 顯示後台網址與金鑰」，會看到兩個網址：
   - 學生端收件網址（`…/exec`）：貼到 `index.html` 的 `const GAS_URL = "";`。
   - 老師後台網址（`…/exec?key=…`）：只給老師與助教，投影時可按「公佈模式」隱藏名單與組別。

之後修改 Code.gs 時，請用「管理部署作業 → 編輯 → 新版本」更新同一個部署，網址才不會改變。若重新建立部署，請同步更新 `Code.gs` 的 `CFG.WEBAPP_URL` 與 `index.html` 的 `GAS_URL`。

### 二、學生端放上 GitHub Pages

把本資料夾推到 GitHub repository，Settings → Pages → Deploy from a branch → main / root。學生網址為 `https://<帳號>.github.io/<repo>/`。

上線前可以用 `index.html?api=<GAS網址>` 先測試，不必改檔。

## 課堂流程建議

1. 開放學生網址，請同學帶紙本題本逐題輸入（也可用「快速輸入」一次打 32 個字母後逐題核對）。
2. 同學送出後在紙本填上四項結果，翻到背面讀解讀。
3. 老師在後台看已送出人數；收齊後切到「公佈模式」投影班級代表型、16 型分布與 2017 年以來的趨勢。
4. 學期結束執行「把本年度結果寫入 History」，明年把 `CFG.YEAR` 改成 2027 即可沿用。

## 資料與限制

- 同一學號重複送出只保留最後一次。學生改答案後必須重新送出。
- 網路失敗時，學生可以先看結果，但頁面會標示「尚未送出」並提供重送按鈕；未送出的結果不會進入班級統計。
- 2017 年 P 原檔為 23 人，已依授課教師更正為 27 人（J+P=67，與其他構面一致）。
- 歷年趨勢以比例呈現，因為各年修課人數不同（32–67 人）。
- 班級代表型是四個構面各取多數的組合，不一定是人數最多的類型，兩者在後台分開顯示。

## 測試

```
node tests/test_model.js
npm i playwright && node tests/test_e2e.js && node tests/test_integration.js
```
