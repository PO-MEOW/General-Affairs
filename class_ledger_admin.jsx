import React, { useState, useEffect, useMemo } from "react";
import {
  Plus, Trash2, Wallet, Users, PieChart as PieIcon, Download,
  Check, X, TrendingUp, TrendingDown, Pencil, ListChecks,
  Github, RefreshCcw, CloudUpload, AlertTriangle, Lock, KeyRound
} from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from "recharts";

// ---- 請在這裡填入固定的 GitHub 倉庫資訊（跟 class_ledger_view.jsx 裡的設定要一致）----
// 總務後台就不用每次都重新輸入帳號/倉庫/路徑/分支，只需要貼上自己的 Token 即可。
const GH_OWNER = "PO-MEOW";
const GH_REPO = "General-Affairs";
const GH_PATH = "ledger-data.json";
const GH_BRANCH = "main";

const CATEGORIES = ["班費", "活動經費", "文具用品", "雜項支出", "罰鍰"];
const CHART_COLORS = ["#1F6F6B", "#C98A2E", "#A8452E", "#5C7A9E", "#8C7851", "#5C7A5C", "#9C6B8A"];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function fmt(n) {
  return "NT$ " + Math.round(n || 0).toLocaleString();
}
function b64EncodeUtf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64DecodeUtf8(str) {
  return decodeURIComponent(escape(atob(str.replace(/\n/g, ""))));
}
// 密碼不會用明文存到 GitHub，這裡用瀏覽器內建的 SHA-256 算出雜湊值再存起來
async function hashPassword(pw) {
  const enc = new TextEncoder().encode(pw);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function ClassLedgerAdmin() {
  // ---- GitHub connection (this repo/file IS the shared database) ----
  const [ghToken, setGhToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [sha, setSha] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | loading | saving | saved | error
  const [syncMessage, setSyncMessage] = useState("");

  const [tab, setTab] = useState("ledger");
  const [transactions, setTransactions] = useState([]);
  const [members, setMembers] = useState([]);
  const [className, setClassName] = useState("我的班級");
  const [dueAmount, setDueAmount] = useState(300);
  const [classSize, setClassSize] = useState(38);
  const [editingClassName, setEditingClassName] = useState(false);

  // ---- 總務自訂的管理密碼（存在同一份 GitHub 資料裡，跟 GitHub token 是兩件事）----
  const [adminPassword, setAdminPassword] = useState("");
  const [pwUnlocked, setPwUnlocked] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwInput2, setPwInput2] = useState("");
  const [pwError, setPwError] = useState("");
  const [editingPassword, setEditingPassword] = useState(false);

  const [showTxForm, setShowTxForm] = useState(false);
  const [editingTx, setEditingTx] = useState(null);
  const [txDraft, setTxDraft] = useState(blankTx());

  const [newMemberName, setNewMemberName] = useState("");

  function blankTx() {
    return { id: null, date: todayStr(), item: "", category: CATEGORIES[0], type: "expense", amount: "", note: "" };
  }

  function ghUrl() {
    return `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(GH_PATH)}`;
  }
  function ghHeaders(extra) {
    return {
      Accept: "application/vnd.github+json",
      ...(ghToken ? { Authorization: `token ${ghToken}` } : {}),
      ...extra
    };
  }

  // 第一次連線：用 Token 讀資料，並在同一步驟完成「設定密碼」或「驗證密碼」
  async function handleConnect() {
    setSyncStatus("loading");
    setSyncMessage("");
    setPwError("");
    try {
      const res = await fetch(`${ghUrl()}?ref=${encodeURIComponent(GH_BRANCH)}`, { headers: ghHeaders() });

      if (res.status === 404) {
        // 檔案還不存在：這次輸入的密碼就當作新密碼
        if (pwInput.trim().length < 4) {
          setSyncStatus("idle");
          setPwError("請輸入至少 4 個字元的密碼，第一次連線會用它建立管理密碼。");
          return;
        }
        const hash = await hashPassword(pwInput);
        setSha(null);
        setTransactions([]);
        setMembers([]);
        setClassName("我的班級");
        setDueAmount(300);
        setClassSize(38);
        setAdminPassword(hash);
        setPwUnlocked(true);
        setConnected(true);
        setPwInput("");
        setSyncStatus("idle");
        setSyncMessage("這個檔案還不存在，新增第一筆紀錄後會自動建立，並套用你剛設定的密碼。");
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `讀取失敗（HTTP ${res.status}）`);
      }

      const json = await res.json();
      const decoded = JSON.parse(b64DecodeUtf8(json.content));
      const storedHash = decoded.adminPassword || "";

      let finalHash = storedHash;
      if (storedHash) {
        // 已經有密碼了，必須驗證正確才能進去
        const hash = await hashPassword(pwInput);
        if (hash !== storedHash) {
          setSyncStatus("idle");
          setPwError("密碼不對，請再試一次。");
          return;
        }
      } else {
        // 資料存在，但還沒設定過密碼：用這次輸入的密碼補上
        if (pwInput.trim().length < 4) {
          setSyncStatus("idle");
          setPwError("這份資料還沒有設定密碼，請輸入至少 4 個字元的密碼再連接。");
          return;
        }
        finalHash = await hashPassword(pwInput);
      }

      setSha(json.sha);
      const nextTransactions = Array.isArray(decoded.transactions) ? decoded.transactions : [];
      const nextMembers = Array.isArray(decoded.members) ? decoded.members : [];
      const nextClassName = decoded.className || "我的班級";
      const nextDueAmount = decoded.dueAmount || 300;
      const nextClassSize = decoded.classSize || 38;

      setTransactions(nextTransactions);
      setMembers(nextMembers);
      setClassName(nextClassName);
      setDueAmount(nextDueAmount);
      setClassSize(nextClassSize);
      setAdminPassword(finalHash);
      setPwUnlocked(true);
      setConnected(true);
      setPwInput("");
      setSyncStatus("saved");
      setSyncMessage("已連上 GitHub，密碼正確，資料是最新版本。");

      if (!storedHash) {
        // 補存密碼，避免下次連線又被當成沒設定過
        await saveToGithub({
          className: nextClassName, dueAmount: nextDueAmount, classSize: nextClassSize,
          transactions: nextTransactions, members: nextMembers, adminPassword: finalHash
        });
      }
    } catch (e) {
      setSyncStatus("error");
      setSyncMessage(e.message || "連線失敗，請確認 Token 是否正確。");
    }
  }

  // 已經連線、密碼也對過一次之後，用來重新抓最新資料（不需要再輸入密碼）
  async function reloadFromGithub() {
    setSyncStatus("loading");
    setSyncMessage("");
    try {
      const res = await fetch(`${ghUrl()}?ref=${encodeURIComponent(GH_BRANCH)}`, { headers: ghHeaders() });
      if (res.status === 404) {
        setSyncStatus("idle");
        setSyncMessage("這個檔案還不存在，新增第一筆紀錄後會自動建立。");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `讀取失敗（HTTP ${res.status}）`);
      }
      const json = await res.json();
      setSha(json.sha);
      const decoded = JSON.parse(b64DecodeUtf8(json.content));
      setTransactions(Array.isArray(decoded.transactions) ? decoded.transactions : []);
      setMembers(Array.isArray(decoded.members) ? decoded.members : []);
      setClassName(decoded.className || "我的班級");
      setDueAmount(decoded.dueAmount || 300);
      setClassSize(decoded.classSize || 38);
      if (decoded.adminPassword) setAdminPassword(decoded.adminPassword);
      setSyncStatus("saved");
      setSyncMessage("已重新載入，資料是最新版本。");
    } catch (e) {
      setSyncStatus("error");
      setSyncMessage(e.message || "重新載入失敗，請確認 Token 是否正確。");
    }
  }

  // core save: always call with the FULL next state (transactions/members/settings)
  async function saveToGithub(next) {
    setSyncStatus("saving");
    try {
      const payload = {
        className: next.className,
        dueAmount: next.dueAmount,
        classSize: next.classSize,
        transactions: next.transactions,
        members: next.members,
        adminPassword: next.adminPassword !== undefined ? next.adminPassword : adminPassword,
        updatedAt: new Date().toISOString()
      };
      const body = {
        message: `更新班費紀錄 ${new Date().toLocaleString("zh-TW")}`,
        content: b64EncodeUtf8(JSON.stringify(payload, null, 2)),
        branch: GH_BRANCH,
        ...(sha ? { sha } : {})
      };
      const res = await fetch(ghUrl(), {
        method: "PUT",
        headers: ghHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        if (res.status === 409 || /sha/i.test(errBody.message || "")) {
          throw new Error("資料已被其他裝置更新過，請先按「重新載入」再修改一次。");
        }
        throw new Error(errBody.message || `儲存失敗（HTTP ${res.status}）`);
      }
      const data = await res.json();
      setSha(data.content.sha);
      setSyncStatus("saved");
      setSyncMessage("已儲存到 GitHub，同學畫面稍後會自動看到更新。");
    } catch (e) {
      setSyncStatus("error");
      setSyncMessage(e.message || "儲存失敗，請檢查 Token 權限。");
    }
  }

  function currentSettings(overrides = {}) {
    return { className, dueAmount, classSize, adminPassword, ...overrides };
  }

  async function persistTransactions(list) {
    setTransactions(list);
    await saveToGithub({ ...currentSettings(), transactions: list, members });
  }
  async function persistMembers(list) {
    setMembers(list);
    await saveToGithub({ ...currentSettings(), transactions, members: list });
  }
  async function persistSettings(next) {
    setClassName(next.className);
    setDueAmount(next.dueAmount);
    setClassSize(next.classSize);
    await saveToGithub({ ...next, transactions, members });
  }

  // ---- derived ----
  const totalIncome = useMemo(() => transactions.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0), [transactions]);
  const totalExpense = useMemo(() => transactions.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0), [transactions]);
  const balance = totalIncome - totalExpense;

  const expenseByCategory = useMemo(() => {
    const map = {};
    transactions.filter(t => t.type === "expense").forEach(t => {
      map[t.category] = (map[t.category] || 0) + Number(t.amount);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [transactions]);

  const paidCount = members.filter(m => m.paid).length;
  const collectedTotal = members.filter(m => m.paid).reduce((s, m) => s + Number(m.amount), 0);
  const outstandingTotal = members.filter(m => !m.paid).reduce((s, m) => s + Number(m.amount), 0);

  const sortedTx = useMemo(() => [...transactions].sort((a, b) => (a.date < b.date ? 1 : -1)), [transactions]);

  // ---- transaction handlers ----
  function openAddTx() {
    setEditingTx(null);
    setTxDraft(blankTx());
    setShowTxForm(true);
  }
  function openEditTx(tx) {
    setEditingTx(tx.id);
    setTxDraft({ ...tx, amount: String(tx.amount) });
    setShowTxForm(true);
  }
  function saveTx() {
    if (!txDraft.item.trim() || !txDraft.amount || Number(txDraft.amount) <= 0) return;
    const clean = { ...txDraft, amount: Number(txDraft.amount) };
    if (editingTx) {
      persistTransactions(transactions.map(t => (t.id === editingTx ? clean : t)));
    } else {
      clean.id = uid();
      persistTransactions([...transactions, clean]);
    }
    setShowTxForm(false);
    setEditingTx(null);
  }
  function deleteTx(id) {
    persistTransactions(transactions.filter(t => t.id !== id));
  }

  // ---- member handlers ----
  function addMember() {
    const name = newMemberName.trim();
    if (!name) return;
    persistMembers([...members, { id: uid(), name, paid: false, amount: dueAmount, txId: null }]);
    setNewMemberName("");
  }
  function removeMember(m) {
    const nextTx = m.txId ? transactions.filter(t => t.id !== m.txId) : transactions;
    const nextMembers = members.filter(x => x.id !== m.id);
    setTransactions(nextTx);
    setMembers(nextMembers);
    saveToGithub({ ...currentSettings(), transactions: nextTx, members: nextMembers });
  }
  function togglePaid(m) {
    if (!m.paid) {
      const tx = {
        id: uid(), date: todayStr(), item: `${m.name} 繳交班費`,
        category: "班費", type: "income", amount: Number(m.amount), note: "班費收款"
      };
      const nextTx = [...transactions, tx];
      const nextMembers = members.map(x => (x.id === m.id ? { ...x, paid: true, txId: tx.id } : x));
      setTransactions(nextTx);
      setMembers(nextMembers);
      saveToGithub({ ...currentSettings(), transactions: nextTx, members: nextMembers });
    } else {
      const nextTx = m.txId ? transactions.filter(t => t.id !== m.txId) : transactions;
      const nextMembers = members.map(x => (x.id === m.id ? { ...x, paid: false, txId: null } : x));
      setTransactions(nextTx);
      setMembers(nextMembers);
      saveToGithub({ ...currentSettings(), transactions: nextTx, members: nextMembers });
    }
  }

  function exportCSV() {
    const header = "日期,項目,分類,類型,金額,備註\n";
    const rows = sortedTx.map(t =>
      [t.date, t.item, t.category, t.type === "income" ? "收入" : "支出", t.amount, t.note || ""]
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${className}_記帳明細_${todayStr()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---- 管理密碼 handlers ----
  async function handleUnlock() {
    setPwError("");
    const hash = await hashPassword(pwInput);
    if (hash === adminPassword) {
      setPwUnlocked(true);
      setPwInput("");
    } else {
      setPwError("密碼不對，請再試一次。");
    }
  }

  function handleLock() {
    setPwUnlocked(false);
    setPwInput("");
    setPwError("");
  }

  async function handleChangePassword() {
    setPwError("");
    if (pwInput.length < 4) { setPwError("新密碼至少要 4 個字元。"); return; }
    if (pwInput !== pwInput2) { setPwError("兩次輸入的新密碼不一樣。"); return; }
    const hash = await hashPassword(pwInput);
    setAdminPassword(hash);
    setPwInput("");
    setPwInput2("");
    setEditingPassword(false);
    await saveToGithub({ ...currentSettings({ adminPassword: hash }), transactions, members });
  }

  const canConnect = ghToken.trim().length > 0 && pwInput.trim().length > 0;

  return (
    <div className="cl-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@500;700;900&family=Noto+Sans+TC:wght@400;500;700&display=swap');
        .cl-root {
          --bg: #F1F3ED; --paper: #FFFFFF; --ink: #2A2B22; --ink-light: #6B6D5E;
          --red: #A8452E; --teal: #1F6F6B; --amber: #C98A2E; --line: #DCDFD3;
          font-family: 'Noto Sans TC', sans-serif; background: var(--bg); color: var(--ink);
          min-height: 100%; box-sizing: border-box;
        }
        .cl-root * { box-sizing: border-box; }
        .cl-shell { max-width: 880px; margin: 0 auto; padding: 28px 20px 60px; position: relative; }
        .cl-shell::before {
          content: ""; position: absolute; top: 0; bottom: 0; left: 14px; width: 2px;
          background: repeating-linear-gradient(to bottom, var(--red) 0 6px, transparent 6px 12px);
          opacity: 0.35; pointer-events: none;
        }
        .cl-header { background: var(--paper); border-radius: 4px; border: 1px solid var(--line); padding: 24px 28px; position: relative; box-shadow: 0 1px 0 var(--line); }
        .cl-ribbon { position: absolute; top: -2px; right: 28px; width: 26px; height: 46px; background: var(--red); clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%); }
        .cl-title-row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
        .cl-title { font-family: 'Noto Serif TC', serif; font-weight: 900; font-size: 26px; margin: 0; cursor: text; border-bottom: 1px dashed transparent; }
        .cl-title:hover { border-bottom: 1px dashed var(--line); }
        .cl-subtitle { font-size: 12px; color: var(--ink-light); letter-spacing: 2px; }
        .cl-note { font-size: 12px; color: var(--ink-light); margin-top: 4px; }
        .cl-hero { margin-top: 18px; }
        .cl-hero-label { font-size: 13px; color: var(--ink-light); }
        .cl-hero-amount { font-family: 'Noto Serif TC', serif; font-weight: 900; font-size: 42px; line-height: 1.15; }
        .cl-hero-amount.neg { color: var(--red); }
        .cl-stats-row { display: flex; gap: 14px; margin-top: 16px; flex-wrap: wrap; }
        .cl-stat { flex: 1; min-width: 140px; border: 1px solid var(--line); border-radius: 4px; padding: 10px 14px; display: flex; align-items: center; gap: 10px; }
        .cl-stat .val { font-weight: 700; font-size: 16px; }
        .cl-stat.income .val { color: var(--teal); }
        .cl-stat.expense .val { color: var(--red); }
        .cl-stat .lab { font-size: 12px; color: var(--ink-light); }

        .cl-gh-box { background: var(--paper); border: 1px solid var(--line); border-radius: 4px; padding: 18px 20px; margin-bottom: 18px; }
        .cl-gh-title { display: flex; align-items: center; gap: 8px; font-family: 'Noto Serif TC', serif; font-weight: 700; font-size: 15px; margin-bottom: 4px; }
        .cl-gh-desc { font-size: 12px; color: var(--ink-light); line-height: 1.6; margin-bottom: 14px; }
        .cl-gh-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .cl-gh-grid .full { grid-column: 1 / -1; }
        .cl-gh-grid label { font-size: 12px; color: var(--ink-light); display: block; margin-bottom: 4px; }
        .cl-gh-grid input { width: 100%; border: 1px solid var(--line); border-radius: 4px; padding: 8px 10px; font-size: 13px; font-family: monospace; }
        .cl-gh-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; flex-wrap: wrap; gap: 8px; }
        .cl-gh-warning { display: flex; gap: 8px; align-items: flex-start; background: #FBF3EC; border: 1px solid #E9D4B8; border-radius: 4px; padding: 10px 12px; font-size: 12px; color: #7A5A2E; margin-top: 12px; line-height: 1.6; }
        .cl-sync-row { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-top: 4px; }
        .cl-sync-row.saved { color: var(--teal); }
        .cl-sync-row.error { color: var(--red); }
        .cl-sync-row.loading, .cl-sync-row.saving { color: var(--ink-light); }

        .cl-pw-box { max-width: 380px; margin: 20px auto 0; text-align: center; }
        .cl-pw-icon { width: 44px; height: 44px; border-radius: 50%; background: var(--bg); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; color: var(--ink-light); }
        .cl-pw-title { font-family: 'Noto Serif TC', serif; font-weight: 700; font-size: 18px; margin-bottom: 4px; }
        .cl-pw-desc { font-size: 12px; color: var(--ink-light); margin-bottom: 16px; line-height: 1.6; }
        .cl-pw-field { text-align: left; margin-bottom: 10px; }
        .cl-pw-field label { display: block; font-size: 12px; color: var(--ink-light); margin-bottom: 4px; }
        .cl-pw-field input { width: 100%; border: 1px solid var(--line); border-radius: 4px; padding: 9px 12px; font-size: 14px; font-family: 'Noto Sans TC', sans-serif; }
        .cl-pw-error { color: var(--red); font-size: 12px; margin: 6px 0 4px; text-align: left; }
        .cl-pw-actions { margin-top: 12px; }
        .cl-pw-actions .cl-btn { width: 100%; justify-content: center; }
        .cl-header-actions { display: flex; gap: 8px; position: absolute; top: 22px; right: 60px; }
        .cl-mini-btn { display: inline-flex; align-items: center; gap: 5px; background: none; border: 1px solid var(--line); border-radius: 4px; padding: 5px 10px; font-size: 12px; color: var(--ink-light); cursor: pointer; font-family: 'Noto Sans TC', sans-serif; }
        .cl-mini-btn:hover { color: var(--ink); }
        .cl-mini-btn .spin { animation: cl-spin 0.6s linear; }
        @keyframes cl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .cl-pw-modal-backdrop { position: fixed; inset: 0; background: rgba(42,43,34,0.45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
        .cl-pw-modal { background: var(--paper); border-radius: 6px; padding: 24px; width: 100%; max-width: 360px; }

        .cl-tabs { display: flex; gap: 6px; margin-top: 22px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
        .cl-tab { padding: 10px 16px; font-size: 14px; font-weight: 500; cursor: pointer; color: var(--ink-light); border-bottom: 2px solid transparent; display: flex; align-items: center; gap: 6px; background: none; border-top: none; border-left: none; border-right: none; font-family: 'Noto Sans TC', sans-serif; }
        .cl-tab.active { color: var(--ink); border-bottom: 2px solid var(--red); font-weight: 700; }

        .cl-panel { margin-top: 18px; }
        .cl-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; }
        .cl-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--ink); color: #fff; border: none; padding: 9px 16px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: 'Noto Sans TC', sans-serif; }
        .cl-btn.secondary { background: transparent; color: var(--ink); border: 1px solid var(--line); }
        .cl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .cl-btn:hover:not(:disabled) { opacity: 0.88; }

        .cl-form { background: var(--paper); border: 1px solid var(--line); border-radius: 4px; padding: 18px; margin-bottom: 16px; }
        .cl-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .cl-field { display: flex; flex-direction: column; gap: 4px; }
        .cl-field label { font-size: 12px; color: var(--ink-light); }
        .cl-field input, .cl-field select { border: 1px solid var(--line); border-radius: 4px; padding: 8px 10px; font-size: 14px; font-family: 'Noto Sans TC', sans-serif; color: var(--ink); background: #fff; }
        .cl-type-toggle { display: flex; gap: 8px; }
        .cl-type-toggle button { flex: 1; padding: 8px; border-radius: 4px; border: 1px solid var(--line); background: #fff; cursor: pointer; font-size: 13px; font-family: 'Noto Sans TC', sans-serif; }
        .cl-type-toggle button.on-income { background: var(--teal); color: #fff; border-color: var(--teal); }
        .cl-type-toggle button.on-expense { background: var(--red); color: #fff; border-color: var(--red); }
        .cl-form-actions { display: flex; gap: 8px; margin-top: 14px; justify-content: flex-end; }

        .cl-tx-list { display: flex; flex-direction: column; gap: 0; }
        .cl-tx-row { display: flex; align-items: center; gap: 12px; padding: 12px 6px; border-bottom: 1px solid var(--line); }
        .cl-tx-date { font-size: 12px; color: var(--ink-light); width: 78px; flex-shrink: 0; }
        .cl-tx-main { flex: 1; min-width: 0; }
        .cl-tx-item { font-weight: 500; font-size: 14px; }
        .cl-tx-meta { font-size: 12px; color: var(--ink-light); margin-top: 2px; }
        .cl-tag { display: inline-block; font-size: 11px; padding: 1px 8px; border-radius: 10px; background: var(--bg); color: var(--ink-light); margin-right: 6px; }
        .cl-tx-amount { font-weight: 700; font-size: 15px; width: 110px; text-align: right; flex-shrink: 0; }
        .cl-tx-amount.income { color: var(--teal); }
        .cl-tx-amount.expense { color: var(--red); }
        .cl-tx-actions { display: flex; gap: 4px; flex-shrink: 0; }
        .cl-icon-btn { background: none; border: none; cursor: pointer; padding: 6px; color: var(--ink-light); border-radius: 4px; }
        .cl-icon-btn:hover { background: var(--bg); color: var(--ink); }
        .cl-empty { text-align: center; padding: 40px 10px; color: var(--ink-light); font-size: 14px; }

        .cl-member-settings { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; font-size: 13px; color: var(--ink-light); flex-wrap: wrap; }
        .cl-member-settings input { width: 90px; border: 1px solid var(--line); border-radius: 4px; padding: 6px 8px; font-size: 13px; }
        .cl-member-summary { display: flex; gap: 14px; margin-bottom: 16px; flex-wrap: wrap; }
        .cl-member-add { display: flex; gap: 8px; margin-bottom: 14px; }
        .cl-member-add input { flex: 1; border: 1px solid var(--line); border-radius: 4px; padding: 9px 12px; font-size: 14px; }
        .cl-member-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
        .cl-member-card { border: 1px solid var(--line); border-radius: 4px; padding: 12px 14px; background: var(--paper); display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .cl-member-card.paid { border-color: var(--teal); background: #F3F8F7; }
        .cl-member-name { font-weight: 500; font-size: 14px; }
        .cl-member-amt { font-size: 12px; color: var(--ink-light); }
        .cl-member-btns { display: flex; align-items: center; gap: 4px; }
        .cl-check { width: 26px; height: 26px; border-radius: 50%; border: 1.5px solid var(--line); display: flex; align-items: center; justify-content: center; cursor: pointer; background: #fff; }
        .cl-check.on { background: var(--teal); border-color: var(--teal); color: #fff; }

        .cl-chart-grid { display: grid; grid-template-columns: 1fr; gap: 22px; }
        .cl-chart-card { background: var(--paper); border: 1px solid var(--line); border-radius: 4px; padding: 18px; }
        .cl-chart-title { font-family: 'Noto Serif TC', serif; font-weight: 700; font-size: 15px; margin-bottom: 8px; }

        @media (max-width: 560px) {
          .cl-form-grid, .cl-gh-grid { grid-template-columns: 1fr; }
          .cl-tx-date { width: 58px; }
          .cl-tx-amount { width: 84px; }
          .cl-header-actions { position: static; margin-top: 12px; flex-wrap: wrap; }
          .cl-ribbon { display: none; }
        }
      `}</style>

      <div className="cl-shell">
        {!connected && (
          <div className="cl-gh-box">
            <div className="cl-gh-title"><Github size={17} /> GitHub 連線設定（總務專用・後台）</div>
            <div className="cl-gh-desc">
              這裡的資料會直接寫進 GitHub 倉庫裡的一個 JSON 檔案，同學版每 10 秒會去讀同一個檔案，
              所以總務這邊儲存之後，同學畫面會自動跟著更新，不需要複製貼上任何東西。
            </div>
            <div className="cl-gh-grid">
              <div className="full">
                <label>Personal Access Token（需要該倉庫的 Contents 讀寫權限）</label>
                <input type="password" placeholder="ghp_xxxxxxxxxxxx" value={ghToken} onChange={e => setGhToken(e.target.value)} onKeyDown={e => e.key === "Enter" && canConnect && handleConnect()} />
              </div>
              <div className="full">
                <label>管理密碼（第一次連線會直接建立這組密碼；之後連線要輸入同一組才能進去）</label>
                <input type="password" placeholder="至少 4 個字元" value={pwInput} onChange={e => setPwInput(e.target.value)} onKeyDown={e => e.key === "Enter" && canConnect && handleConnect()} />
              </div>
            </div>
            {pwError && <div className="cl-pw-error">{pwError}</div>}
            <div className="cl-gh-actions">
              <button className="cl-btn" disabled={!canConnect} onClick={handleConnect}>
                <RefreshCcw size={14} /> 連接並登入
              </button>
              {syncMessage && (
                <div className={"cl-sync-row " + syncStatus}>
                  {syncStatus === "saving" && <CloudUpload size={14} />}
                  {syncMessage}
                </div>
              )}
            </div>
            <div className="cl-gh-warning">
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                Token 只會留在這個頁面的記憶體裡，不會被儲存，重新整理頁面後要再貼一次。
                建議用 GitHub 的 <strong>fine-grained token</strong>，只授權「這一個倉庫」的 Contents 讀寫權限，
                不要用有完整帳號權限的舊版 token，也不要把這個管理頁面的網址公開給同學。
                管理密碼則是額外一層保護，忘記密碼的話要請熟悉 GitHub 的人直接打開該 JSON 檔案清空 adminPassword 欄位。
              </div>
            </div>
          </div>
        )}

        {connected && !pwUnlocked && (
          <div className="cl-header cl-pw-box">
            <div className="cl-pw-icon"><Lock size={20} /></div>
            <div className="cl-pw-title">請輸入管理密碼</div>
            <div className="cl-pw-desc">已經連上 GitHub，請輸入密碼才能查看與修改帳目。</div>
            <div className="cl-pw-field">
              <label>管理密碼</label>
              <input type="password" autoFocus value={pwInput} onChange={e => setPwInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleUnlock()} />
            </div>
            {pwError && <div className="cl-pw-error">{pwError}</div>}
            <div className="cl-pw-actions">
              <button className="cl-btn" onClick={handleUnlock}>解鎖</button>
            </div>
          </div>
        )}

        {connected && pwUnlocked && (
          <>
            <div className="cl-header">
              <div className="cl-ribbon" />
              <div className="cl-header-actions">
                <button className="cl-mini-btn" onClick={reloadFromGithub}><RefreshCcw size={13} className={syncStatus === "loading" ? "spin" : ""} /> 重新載入</button>
                <button className="cl-mini-btn" onClick={() => { setEditingPassword(true); setPwInput(""); setPwInput2(""); setPwError(""); }}><KeyRound size={13} /> 變更密碼</button>
                <button className="cl-mini-btn" onClick={handleLock}><Lock size={13} /> 鎖定</button>
              </div>
              {syncMessage && connected && pwUnlocked && (
                <div className={"cl-sync-row " + syncStatus} style={{ marginTop: 4 }}>
                  {syncStatus === "saving" && <CloudUpload size={14} />}
                  {syncMessage}
                </div>
              )}
              <div className="cl-title-row">
                {editingClassName ? (
                  <input
                    autoFocus
                    value={className}
                    onChange={e => setClassName(e.target.value)}
                    onBlur={() => { setEditingClassName(false); persistSettings({ className, dueAmount, classSize }); }}
                    onKeyDown={e => e.key === "Enter" && e.target.blur()}
                    style={{ fontFamily: "'Noto Serif TC', serif", fontWeight: 900, fontSize: 26, border: "1px solid var(--line)", borderRadius: 4, padding: "2px 8px" }}
                  />
                ) : (
                  <h1 className="cl-title" onClick={() => setEditingClassName(true)} title="點擊修改班級名稱">
                    {className} 記帳簿
                  </h1>
                )}
              </div>
              <div className="cl-subtitle">CLASS TREASURY LEDGER · 總務後台</div>
              <div className="cl-note">每次新增／修改都會自動同步到 GitHub，同學畫面最多 10 秒內會看到最新結果。</div>

              <div className="cl-hero">
                <div className="cl-hero-label">目前結餘</div>
                <div className={"cl-hero-amount" + (balance < 0 ? " neg" : "")}>{fmt(balance)}</div>
              </div>

              <div className="cl-stats-row">
                <div className="cl-stat income">
                  <TrendingUp size={18} color="var(--teal)" />
                  <div><div className="lab">總收入</div><div className="val">{fmt(totalIncome)}</div></div>
                </div>
                <div className="cl-stat expense">
                  <TrendingDown size={18} color="var(--red)" />
                  <div><div className="lab">總支出</div><div className="val">{fmt(totalExpense)}</div></div>
                </div>
                <div className="cl-stat">
                  <Users size={18} color="var(--ink-light)" />
                  <div><div className="lab">班費繳交</div><div className="val">{paidCount}/{classSize} 人</div></div>
                </div>
              </div>
            </div>

            <div className="cl-tabs">
              <button className={"cl-tab" + (tab === "ledger" ? " active" : "")} onClick={() => setTab("ledger")}>
                <Wallet size={15} /> 收支明細
              </button>
              <button className={"cl-tab" + (tab === "members" ? " active" : "")} onClick={() => setTab("members")}>
                <ListChecks size={15} /> 班費收款
              </button>
              <button className={"cl-tab" + (tab === "chart" ? " active" : "")} onClick={() => setTab("chart")}>
                <PieIcon size={15} /> 統計圖表
              </button>
            </div>

            {tab === "ledger" && (
              <div className="cl-panel">
                <div className="cl-toolbar">
                  <button className="cl-btn" onClick={openAddTx}><Plus size={15} /> 新增紀錄</button>
                  <button className="cl-btn secondary" onClick={exportCSV}><Download size={15} /> 匯出 CSV</button>
                </div>

                {showTxForm && (
                  <div className="cl-form">
                    <div className="cl-type-toggle" style={{ marginBottom: 12 }}>
                      <button className={txDraft.type === "income" ? "on-income" : ""} onClick={() => setTxDraft({ ...txDraft, type: "income" })}>收入</button>
                      <button className={txDraft.type === "expense" ? "on-expense" : ""} onClick={() => setTxDraft({ ...txDraft, type: "expense" })}>支出</button>
                    </div>
                    <div className="cl-form-grid">
                      <div className="cl-field"><label>日期</label><input type="date" value={txDraft.date} onChange={e => setTxDraft({ ...txDraft, date: e.target.value })} /></div>
                      <div className="cl-field"><label>金額</label><input type="number" placeholder="0" value={txDraft.amount} onChange={e => setTxDraft({ ...txDraft, amount: e.target.value })} /></div>
                      <div className="cl-field"><label>項目名稱</label><input placeholder="例：影印紙" value={txDraft.item} onChange={e => setTxDraft({ ...txDraft, item: e.target.value })} /></div>
                      <div className="cl-field">
                        <label>分類</label>
                        <select value={txDraft.category} onChange={e => setTxDraft({ ...txDraft, category: e.target.value })}>
                          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="cl-field" style={{ gridColumn: "1 / -1" }}><label>備註（選填）</label><input value={txDraft.note} onChange={e => setTxDraft({ ...txDraft, note: e.target.value })} /></div>
                    </div>
                    <div className="cl-form-actions">
                      <button className="cl-btn secondary" onClick={() => setShowTxForm(false)}>取消</button>
                      <button className="cl-btn" onClick={saveTx}>{editingTx ? "儲存修改" : "新增"}</button>
                    </div>
                  </div>
                )}

                {sortedTx.length === 0 ? (
                  <div className="cl-empty">還沒有任何紀錄，點選「新增紀錄」開始記帳吧。</div>
                ) : (
                  <div className="cl-tx-list">
                    {sortedTx.map(t => (
                      <div className="cl-tx-row" key={t.id}>
                        <div className="cl-tx-date">{t.date.slice(5)}</div>
                        <div className="cl-tx-main">
                          <div className="cl-tx-item">{t.item}</div>
                          <div className="cl-tx-meta"><span className="cl-tag">{t.category}</span>{t.note && <span>{t.note}</span>}</div>
                        </div>
                        <div className={"cl-tx-amount " + t.type}>{t.type === "income" ? "+" : "−"}{fmt(t.amount).replace("NT$ ", "")}</div>
                        <div className="cl-tx-actions">
                          <button className="cl-icon-btn" onClick={() => openEditTx(t)}><Pencil size={15} /></button>
                          <button className="cl-icon-btn" onClick={() => deleteTx(t.id)}><Trash2 size={15} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "members" && (
              <div className="cl-panel">
                <div className="cl-member-settings">
                  <span>每人應繳班費金額</span>
                  <input type="number" value={dueAmount} onChange={e => { const v = Number(e.target.value) || 0; setDueAmount(v); persistSettings({ className, dueAmount: v, classSize }); }} />
                  <span>元（適用於新加入的同學）</span>
                  <span style={{ marginLeft: 10 }}>班級總人數</span>
                  <input type="number" value={classSize} onChange={e => { const v = Number(e.target.value) || 0; setClassSize(v); persistSettings({ className, dueAmount, classSize: v }); }} />
                  <span>人</span>
                </div>

                <div className="cl-member-summary">
                  <div className="cl-stat income" style={{ minWidth: 160 }}>
                    <Check size={16} color="var(--teal)" />
                    <div><div className="lab">已收金額</div><div className="val">{fmt(collectedTotal)}</div></div>
                  </div>
                  <div className="cl-stat expense" style={{ minWidth: 160 }}>
                    <X size={16} color="var(--red)" />
                    <div><div className="lab">未收金額</div><div className="val">{fmt(outstandingTotal)}</div></div>
                  </div>
                </div>

                <div className="cl-member-add">
                  <input placeholder="輸入同學姓名" value={newMemberName} onChange={e => setNewMemberName(e.target.value)} onKeyDown={e => e.key === "Enter" && addMember()} />
                  <button className="cl-btn" onClick={addMember}><Plus size={15} /> 加入名單</button>
                </div>

                {members.length === 0 ? (
                  <div className="cl-empty">還沒有加入任何同學，請在上方輸入姓名。</div>
                ) : (
                  <div className="cl-member-grid">
                    {members.map(m => (
                      <div className={"cl-member-card" + (m.paid ? " paid" : "")} key={m.id}>
                        <div>
                          <div className="cl-member-name">{m.name}</div>
                          <div className="cl-member-amt">{fmt(m.amount)}{m.paid ? "・已繳" : "・未繳"}</div>
                        </div>
                        <div className="cl-member-btns">
                          <div className={"cl-check" + (m.paid ? " on" : "")} onClick={() => togglePaid(m)} title={m.paid ? "取消繳費" : "標記已繳"}>
                            {m.paid ? <Check size={15} /> : null}
                          </div>
                          <button className="cl-icon-btn" onClick={() => removeMember(m)}><Trash2 size={15} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "chart" && (
              <div className="cl-panel cl-chart-grid">
                <div className="cl-chart-card">
                  <div className="cl-chart-title">支出分類佔比</div>
                  {expenseByCategory.length === 0 ? (
                    <div className="cl-empty">目前尚無支出紀錄。</div>
                  ) : (
                    <div style={{ width: "100%", height: 280 }}>
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie data={expenseByCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} label={({ name, value }) => `${name} ${fmt(value)}`}>
                            {expenseByCategory.map((entry, i) => <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v) => fmt(v)} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
                <div className="cl-chart-card">
                  <div className="cl-chart-title">收入 vs 支出</div>
                  <div style={{ width: "100%", height: 220 }}>
                    <ResponsiveContainer>
                      <BarChart data={[{ name: "總計", 收入: totalIncome, 支出: totalExpense }]} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#DCDFD3" />
                        <XAxis type="number" />
                        <YAxis type="category" dataKey="name" width={40} />
                        <Tooltip formatter={(v) => fmt(v)} />
                        <Legend />
                        <Bar dataKey="收入" fill="#1F6F6B" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="支出" fill="#A8452E" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {editingPassword && (
          <div className="cl-pw-modal-backdrop" onClick={() => setEditingPassword(false)}>
            <div className="cl-pw-modal" onClick={e => e.stopPropagation()}>
              <div className="cl-pw-icon"><KeyRound size={20} /></div>
              <div className="cl-pw-title" style={{ textAlign: "center" }}>變更管理密碼</div>
              <div className="cl-pw-field" style={{ marginTop: 14 }}>
                <label>新密碼（至少 4 個字元）</label>
                <input type="password" autoFocus value={pwInput} onChange={e => setPwInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleChangePassword()} />
              </div>
              <div className="cl-pw-field">
                <label>再輸入一次確認</label>
                <input type="password" value={pwInput2} onChange={e => setPwInput2(e.target.value)} onKeyDown={e => e.key === "Enter" && handleChangePassword()} />
              </div>
              {pwError && <div className="cl-pw-error">{pwError}</div>}
              <div className="cl-pw-actions" style={{ display: "flex", gap: 8 }}>
                <button className="cl-btn secondary" style={{ flex: 1 }} onClick={() => setEditingPassword(false)}>取消</button>
                <button className="cl-btn" style={{ flex: 1 }} onClick={handleChangePassword}>儲存新密碼</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
