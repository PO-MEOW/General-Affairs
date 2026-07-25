import React, { useState, useEffect, useRef } from "react";
import { TrendingUp, TrendingDown, RefreshCcw } from "lucide-react";

const POLL_MS = 10000; // 每 10 秒向 GitHub 拉一次最新資料

// ---- 請在這裡填入總務後台設定的同一組資訊，同學版就不需要任何登入畫面 ----
const GH_OWNER = "your-github-username";
const GH_REPO = "your-repo-name";
const GH_PATH = "ledger-data.json";
const GH_BRANCH = "main";

function fmt(n) {
  return "NT$ " + Math.round(n || 0).toLocaleString();
}

export default function ClassLedgerView() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | loading | ok | error
  const [errorMsg, setErrorMsg] = useState("");
  const [lastChecked, setLastChecked] = useState(null);
  const pollRef = useRef(null);

  function rawUrl() {
    // cache-busting query string so the CDN doesn't serve a stale copy
    return `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${GH_PATH}?t=${Date.now()}`;
  }

  async function fetchData(showLoading) {
    if (showLoading) setStatus("loading");
    try {
      const res = await fetch(rawUrl(), { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "還找不到這個檔案，請確認總務已經存過一次資料。" : `讀取失敗（HTTP ${res.status}）`);
      const json = await res.json();
      setData(json);
      setStatus("ok");
      setErrorMsg("");
      setLastChecked(new Date());
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "讀取失敗，請確認 GH_OWNER / GH_REPO / GH_PATH 是否填對。");
    }
  }

  useEffect(() => {
    fetchData(true);
    pollRef.current = setInterval(() => fetchData(false), POLL_MS);
    return () => clearInterval(pollRef.current);
  }, []);

  const transactions = data && Array.isArray(data.transactions) ? data.transactions : [];
  const totalIncome = transactions.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const totalExpense = transactions.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const balance = totalIncome - totalExpense;
  const sortedTx = [...transactions].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="clv-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@500;700;900&family=Noto+Sans+TC:wght@400;500;700&display=swap');
        .clv-root {
          --bg: #F1F3ED; --paper: #FFFFFF; --ink: #2A2B22; --ink-light: #6B6D5E;
          --red: #A8452E; --teal: #1F6F6B; --line: #DCDFD3;
          font-family: 'Noto Sans TC', sans-serif;
          background: var(--bg); color: var(--ink); min-height: 100%;
        }
        .clv-root * { box-sizing: border-box; }
        .clv-shell { max-width: 720px; margin: 0 auto; padding: 28px 20px 60px; }
        .clv-header { background: var(--paper); border: 1px solid var(--line); border-radius: 4px; padding: 24px 28px; position: relative; }
        .clv-badge { position: absolute; top: -1px; right: 28px; font-size: 11px; letter-spacing: 1px; background: var(--teal); color: #fff; padding: 4px 10px; border-radius: 0 0 4px 4px; }
        .clv-title { font-family: 'Noto Serif TC', serif; font-weight: 900; font-size: 24px; margin: 0; }
        .clv-subtitle { font-size: 12px; color: var(--ink-light); letter-spacing: 2px; margin-top: 2px; }
        .clv-hero-label { font-size: 13px; color: var(--ink-light); margin-top: 18px; }
        .clv-hero-amount { font-family: 'Noto Serif TC', serif; font-weight: 900; font-size: 40px; }
        .clv-hero-amount.neg { color: var(--red); }
        .clv-stats-row { display: flex; gap: 14px; margin-top: 16px; flex-wrap: wrap; }
        .clv-stat { flex: 1; min-width: 140px; border: 1px solid var(--line); border-radius: 4px; padding: 10px 14px; display: flex; align-items: center; gap: 10px; }
        .clv-stat .val { font-weight: 700; font-size: 16px; }
        .clv-stat.income .val { color: var(--teal); }
        .clv-stat.expense .val { color: var(--red); }
        .clv-stat .lab { font-size: 12px; color: var(--ink-light); }
        .clv-updated-row { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; }
        .clv-updated { font-size: 12px; color: var(--ink-light); }
        .clv-refresh-btn { display: inline-flex; align-items: center; gap: 5px; background: none; border: 1px solid var(--line); border-radius: 4px; padding: 5px 10px; font-size: 12px; color: var(--ink-light); cursor: pointer; font-family: 'Noto Sans TC', sans-serif; }
        .clv-refresh-btn:hover { color: var(--ink); }
        .clv-refresh-btn .spin { animation: clv-spin 0.6s linear; }
        @keyframes clv-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .clv-tx-list { margin-top: 22px; }
        .clv-tx-row { display: flex; align-items: center; gap: 12px; padding: 12px 6px; border-bottom: 1px solid var(--line); }
        .clv-tx-date { font-size: 12px; color: var(--ink-light); width: 90px; flex-shrink: 0; }
        .clv-tx-main { flex: 1; min-width: 0; }
        .clv-tx-item { font-weight: 500; font-size: 14px; }
        .clv-tx-meta { font-size: 12px; color: var(--ink-light); margin-top: 2px; }
        .clv-tag { display: inline-block; font-size: 11px; padding: 1px 8px; border-radius: 10px; background: var(--bg); color: var(--ink-light); margin-right: 6px; }
        .clv-tx-amount { font-weight: 700; font-size: 15px; width: 110px; text-align: right; flex-shrink: 0; }
        .clv-tx-amount.income { color: var(--teal); }
        .clv-tx-amount.expense { color: var(--red); }
        .clv-empty { text-align: center; padding: 40px 10px; color: var(--ink-light); font-size: 14px; }
        .clv-error { color: var(--red); font-size: 12px; margin-top: 10px; }
      `}</style>

      <div className="clv-shell">
        <div className="clv-header">
          <div className="clv-badge">班上同學版・唯讀</div>
          <h1 className="clv-title">{data && data.className ? data.className : "班級"} 記帳簿</h1>
          <div className="clv-subtitle">CLASS TREASURY · READ ONLY</div>

          {status === "error" && !data ? (
            <div className="clv-error" style={{ marginTop: 16 }}>{errorMsg}</div>
          ) : (
            <>
              <div className="clv-hero-label">目前結餘</div>
              <div className={"clv-hero-amount" + (balance < 0 ? " neg" : "")}>{fmt(balance)}</div>
              <div className="clv-stats-row">
                <div className="clv-stat income">
                  <TrendingUp size={18} color="var(--teal)" />
                  <div><div className="lab">總收入</div><div className="val">{fmt(totalIncome)}</div></div>
                </div>
                <div className="clv-stat expense">
                  <TrendingDown size={18} color="var(--red)" />
                  <div><div className="lab">總支出</div><div className="val">{fmt(totalExpense)}</div></div>
                </div>
              </div>
            </>
          )}

          <div className="clv-updated-row">
            <div className="clv-updated">
              {data && data.updatedAt
                ? "資料更新時間：" + new Date(data.updatedAt).toLocaleString("zh-TW")
                : "尚未取得資料"}
              {lastChecked && <> ・上次檢查：{lastChecked.toLocaleTimeString("zh-TW")}</>}
            </div>
            <button className="clv-refresh-btn" onClick={() => fetchData(true)}>
              <RefreshCcw size={13} className={status === "loading" ? "spin" : ""} /> 立即檢查
            </button>
          </div>
        </div>

        {data && (
          sortedTx.length === 0 ? (
            <div className="clv-empty">目前尚無收支紀錄。</div>
          ) : (
            <div className="clv-tx-list">
              {sortedTx.map(t => (
                <div className="clv-tx-row" key={t.id}>
                  <div className="clv-tx-date">{t.date}</div>
                  <div className="clv-tx-main">
                    <div className="clv-tx-item">{t.item}</div>
                    <div className="clv-tx-meta">
                      <span className="clv-tag">{t.category}</span>
                      {t.note && <span>{t.note}</span>}
                    </div>
                  </div>
                  <div className={"clv-tx-amount " + t.type}>{t.type === "income" ? "+" : "−"}{fmt(t.amount).toString().replace("NT$ ", "")}</div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
