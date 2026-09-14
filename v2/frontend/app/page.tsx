"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken, getToken, ApiError, Me } from "../lib/api";

type Tab = "pass" | "phone";

export default function AuthPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("phone");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code" | "name">("phone");
  const [devCode, setDevCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) return;
    api<{ me: Me }>("/api/me")
      .then(() => router.push("/chat"))
      .catch(() => setToken(null));
  }, [router]);

  const done = (token: string) => {
    setToken(token);
    router.push("/chat");
  };

  const fail = (e: unknown) => {
    setErr(e instanceof ApiError ? e.message : "خطای شبکه");
    setBusy(false);
  };

  const submitPass = async () => {
    setErr("");
    setBusy(true);
    try {
      if (mode === "login") {
        const d = await api<{ token: string }>("/api/login", {
          method: "POST",
          body: { username, password },
        });
        done(d.token);
      } else {
        const d = await api<{ token: string }>("/api/register", {
          method: "POST",
          body: { username, password },
        });
        done(d.token);
      }
    } catch (e) {
      fail(e);
    }
  };

  const sendCode = async () => {
    setErr("");
    setDevCode("");
    setBusy(true);
    try {
      const d = await api<{ ok: boolean; devCode?: string }>("/api/send-code", {
        method: "POST",
        body: { phone },
      });
      if (d.devCode) setDevCode(d.devCode);
      setStep("code");
    } catch (e) {
      fail(e);
      return;
    }
    setBusy(false);
  };

  const verify = async () => {
    setErr("");
    setBusy(true);
    try {
      const d = await api<{ token?: string; needsName?: boolean }>("/api/verify-code", {
        method: "POST",
        body: { phone, code },
      });
      if (d.token) {
        done(d.token);
        return;
      }
      setStep("name");
    } catch (e) {
      fail(e);
      return;
    }
    setBusy(false);
  };

  const complete = async () => {
    setErr("");
    setBusy(true);
    try {
      const d = await api<{ token: string }>("/api/complete-register", {
        method: "POST",
        body: { phone, code, displayName, username: newUsername },
      });
      done(d.token);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="glass rounded-2xl p-6 w-full max-w-sm">
        <h1 className="text-2xl font-extrabold text-center mb-1">VORTEX</h1>
        <p className="text-center text-sm text-gray-400 mb-5">نسخه‌ی دوم — PHP + Next.js</p>

        <div className="flex gap-2 mb-5">
          <button
            className={"flex-1 rounded-xl py-2 text-sm font-bold " + (tab === "phone" ? "btn-acc" : "glass")}
            onClick={() => setTab("phone")}
          >
            موبایل
          </button>
          <button
            className={"flex-1 rounded-xl py-2 text-sm font-bold " + (tab === "pass" ? "btn-acc" : "glass")}
            onClick={() => setTab("pass")}
          >
            نام کاربری
          </button>
        </div>

        {tab === "pass" ? (
          <div className="space-y-3">
            <div className="flex gap-2 text-sm">
              <button
                className={mode === "login" ? "font-bold text-violet-300" : "text-gray-400"}
                onClick={() => setMode("login")}
              >
                ورود
              </button>
              <span className="text-gray-600">|</span>
              <button
                className={mode === "register" ? "font-bold text-violet-300" : "text-gray-400"}
                onClick={() => setMode("register")}
              >
                ثبت‌نام
              </button>
            </div>
            <input
              className="input"
              placeholder="نام کاربری (انگلیسی)"
              value={username}
              onChange={(e) => setUsername(e.target.value.trim())}
              dir="ltr"
            />
            <input
              className="input"
              type="password"
              placeholder="رمز عبور"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              dir="ltr"
            />
            <button className="btn-acc w-full" disabled={busy} onClick={submitPass}>
              {mode === "login" ? "ورود" : "ساخت حساب"}
            </button>
          </div>
        ) : step === "phone" ? (
          <div className="space-y-3">
            <input
              className="input"
              placeholder="09xxxxxxxxx"
              value={phone}
              onChange={(e) => setPhone(e.target.value.trim())}
              dir="ltr"
              inputMode="numeric"
            />
            <button className="btn-acc w-full" disabled={busy} onClick={sendCode}>
              دریافت کد
            </button>
          </div>
        ) : step === "code" ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">کد ۶ رقمی ارسال‌شده به {phone} را وارد کن:</p>
            {devCode && (
              <p className="text-center text-lg font-bold text-emerald-300" dir="ltr">
                {devCode}
              </p>
            )}
            <input
              className="input text-center text-xl tracking-widest"
              placeholder="------"
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
              dir="ltr"
              inputMode="numeric"
              maxLength={6}
            />
            <button className="btn-acc w-full" disabled={busy} onClick={verify}>
              تأیید
            </button>
            <button className="w-full text-xs text-gray-400" onClick={() => setStep("phone")}>
              تغییر شماره
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">نام نمایشی و (اختیاری) نام کاربری:</p>
            <input
              className="input"
              placeholder="نام نمایشی"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <input
              className="input"
              placeholder="نام کاربری (اختیاری)"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value.trim())}
              dir="ltr"
            />
            <button className="btn-acc w-full" disabled={busy} onClick={complete}>
              ساخت حساب
            </button>
          </div>
        )}

        {err && <p className="mt-4 text-sm text-rose-300 text-center">{err}</p>}
      </div>
    </main>
  );
}
