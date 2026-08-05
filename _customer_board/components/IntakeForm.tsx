"use client";

import { useMemo, useRef, useState } from "react";
import screens from "@/lib/data/screens.json";
import { ScreenPicker } from "@/components/ScreenPicker";
import { MODULE_KR, type Screen } from "@/lib/screen-picker";

const screenList = screens as Screen[];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function IntakeForm() {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [screenCode, setScreenCode] = useState("");
  const [symptom, setSymptom] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedScreen = useMemo(
    () => screenList.find((screen) => screen.code === screenCode),
    [screenCode],
  );
  const screenName = selectedScreen?.name ?? "";

  async function handleFile(f: File | null) {
    setFile(f);
    if (f) setPreview(await fileToDataUrl(f));
    else setPreview(null);
  }

  async function submit() {
    if (!screenCode || !symptom.trim() || !preview) {
      setErrorMsg("화면, 증상, 화면 캡처는 필수입니다.");
      setStatus("error");
      return;
    }
    setStatus("submitting");
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenCode,
          screenName,
          symptom,
          steps,
          expected,
          screenshotDataUrl: preview,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "등록 실패");
      setResultUrl(data.url);
      setStatus("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "알 수 없는 오류");
      setStatus("error");
    }
  }

  function reset() {
    setScreenCode("");
    setSymptom("");
    setSteps("");
    setExpected("");
    setFile(null);
    setPreview(null);
    if (fileInput.current) fileInput.current.value = "";
    setStatus("idle");
    setResultUrl(null);
    setPickerOpen(false);
    setOpen(false);
  }

  // 폼은 헤더 flex 행에 인라인으로 펼치면 헤더 높이를 밀어 레이아웃이 깨진다 — 항상 모달 오버레이로 띄운다
  const doneView = (
    <>
      <h2 id="intake-dialog-title" className="text-sm font-medium mb-1">등록되었습니다.</h2>
      <p className="text-xs text-[var(--sub)] mb-3">
        접수 번호 확인이 필요하면{" "}
        {resultUrl && (
          <a href={resultUrl} target="_blank" rel="noreferrer" className="text-[var(--blue)] underline">
            여기
          </a>
        )}
        를 참고해 주세요.
      </p>
      <button onClick={reset} className="h-8 px-3 text-xs rounded-md border border-[var(--line)]">
        닫기
      </button>
    </>
  );

  const formView = (
    <>
      <h2 id="intake-dialog-title" className="text-sm font-medium mb-4">새 요청 등록</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-xs text-[var(--sub)] mb-1">1. 화면 선택 *</label>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="w-full min-h-12 px-3 py-2 rounded-md border border-[var(--line)] bg-white text-left flex items-center justify-between gap-3 hover:border-[var(--border-strong)]"
          >
            {selectedScreen ? (
              <span className="min-w-0">
                <span className="block text-sm truncate">
                  {MODULE_KR[selectedScreen.module] ?? selectedScreen.module} · {selectedScreen.name}
                </span>
                <span className="block text-[11px] text-[var(--sub)] mt-0.5 font-mono">
                  {selectedScreen.code}
                </span>
              </span>
            ) : (
              <span className="text-sm text-[var(--sub)]">화면을 선택해 주세요</span>
            )}
            <span className="shrink-0 text-xs text-[var(--blue)]">
              {selectedScreen ? "변경" : "선택"}
            </span>
          </button>
        </div>

        <div>
          <label className="block text-xs text-[var(--sub)] mb-1">2. 증상 *</label>
          <textarea
            value={symptom}
            onChange={(e) => setSymptom(e.target.value)}
            placeholder="예: 저장이 안 됩니다, 값이 다르게 표시됩니다"
            className="w-full h-16 px-2 py-2 text-sm rounded-md border border-[var(--line)] resize-none"
          />
        </div>

        <div>
          <label className="block text-xs text-[var(--sub)] mb-1">3. 진행 순서</label>
          <textarea
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder="어떤 순서로 조작하셨을 때 발생했는지"
            className="w-full h-16 px-2 py-2 text-sm rounded-md border border-[var(--line)] resize-none"
          />
        </div>

        <div>
          <label className="block text-xs text-[var(--sub)] mb-1">4. 화면 캡처 *</label>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="미리보기" className="mt-2 max-h-40 rounded-md border border-[var(--line)]" />
          )}
        </div>

        <div>
          <label className="block text-xs text-[var(--sub)] mb-1">5. 기대하시는 동작</label>
          <textarea
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            placeholder="어떻게 되어야 맞는지"
            className="w-full h-16 px-2 py-2 text-sm rounded-md border border-[var(--line)] resize-none"
          />
        </div>

        {status === "error" && <p className="text-xs text-[var(--red)]">{errorMsg}</p>}

        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={status === "submitting"}
            className="h-9 px-4 rounded-md bg-[var(--ink)] text-white text-sm font-medium disabled:opacity-50"
          >
            {status === "submitting" ? "등록 중…" : "등록"}
          </button>
          <button onClick={reset} className="h-9 px-4 rounded-md border border-[var(--line)] text-sm">
            취소
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <button
        onClick={() => {
          setPickerOpen(false);
          setOpen(true);
        }}
        className="flex items-center gap-2 h-9 px-4 rounded-md bg-[var(--ink)] text-white text-sm font-medium"
      >
        + 새 요청 등록
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="intake-dialog-title"
              className={`w-full ${pickerOpen ? "max-w-3xl" : "max-w-md"} mt-10 mb-10 rounded-xl border border-[var(--line)] bg-white p-5 shadow-xl`}
            >
              {status === "done" ? doneView : pickerOpen ? (
                <ScreenPicker
                  screens={screenList}
                  value={screenCode}
                  onSelect={(screen) => {
                    setScreenCode(screen.code);
                    setPickerOpen(false);
                  }}
                  onCancel={() => setPickerOpen(false)}
                />
              ) : formView}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
