<script lang="ts">
  /**
   * レシート画像の四隅を自動検知・手動調整して切り抜くコンポーネント。
   * https://github.com/Asuma09/receipt-uploader のCameraCapture.tsxのうち、
   * 「撮影後に四隅を検知・調整して切り抜く」部分のみを移植したもの。
   * 元実装のカメラ起動・自動シャッター・Notion送信・複数枚バッチ・事業カテゴリ選択は
   * このプロジェクトの設計（既存の<input type="file">で選んだ1件をAIが解析する）に合わないため、
   * 移植していない。撮影・画像選択自体は呼び出し元の既存のファイル選択欄（<input type="file">）が
   * 担い、このコンポーネントは選ばれたFileを受け取ってトリミングUIを出すだけに専念する。
   *
   * confirmCrop()/useFullFrame()で確定した画像はonCaptured(file)で呼び出し元にJPEG Fileとして渡す。
   */
  import { onDestroy } from "svelte";

  let { file, onCaptured, onClose }: { file: File; onCaptured: (file: File) => void; onClose: () => void } = $props();

  let canvasRef = $state<HTMLCanvasElement | null>(null);
  let svgRef = $state<SVGSVGElement | null>(null);
  let imgAreaRef = $state<HTMLDivElement | null>(null);

  let status = $state("読み込み中…");
  let cvReady = $state(false);

  let adjustUrl = $state<string | null>(null);
  let quad = $state<number[][] | null>(null);
  let imgDims = $state({ w: 0, h: 0 });
  let autoDetected = $state(false);
  let dragPos = $state<{ x: number; y: number } | null>(null);
  let dispSize = $state<{ w: number; h: number } | null>(null);

  const cvReadyRef = { current: false };
  const adjustUrlRef = { current: null as string | null };
  const draggingRef = { current: null as number | null };
  const dragRectRef = { current: null as DOMRect | null };
  /** 選択された元画像（切り抜き前）。$stateにする必要はなく、UIの再描画トリガーにも使わない */
  let fullFrame: HTMLCanvasElement | null = null;

  // 4点を tl, tr, br, bl の順に並べ替える。
  function orderQuad(pts: number[][]): number[][] {
    let tl = pts[0];
    let br = pts[0];
    let tr = pts[0];
    let bl = pts[0];
    let minS = Infinity;
    let maxS = -Infinity;
    let maxD = -Infinity;
    let minD = Infinity;
    for (const p of pts) {
      const s = p[0] + p[1];
      const d = p[0] - p[1];
      if (s < minS) { minS = s; tl = p; }
      if (s > maxS) { maxS = s; br = p; }
      if (d > maxD) { maxD = d; tr = p; }
      if (d < minD) { minD = d; bl = p; }
    }
    return [tl, tr, br, bl];
  }

  function boxPoints(rr: any): number[][] {
    const cx = rr.center.x;
    const cy = rr.center.y;
    const w = rr.size.width;
    const h = rr.size.height;
    const angle = (rr.angle * Math.PI) / 180;
    const b = Math.cos(angle) * 0.5;
    const a = Math.sin(angle) * 0.5;
    const p0 = [cx - a * h - b * w, cy + b * h - a * w];
    const p1 = [cx + a * h - b * w, cy - b * h - a * w];
    const p2 = [2 * cx - p0[0], 2 * cy - p0[1]];
    const p3 = [2 * cx - p1[0], 2 * cy - p1[1]];
    return [p0, p1, p2, p3];
  }

  function quadFromMask(cv: any, mask: any, frameArea: number): { quad: number[][]; area: number } | null {
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const approx = new cv.Mat();
    let bestCnt: any = null;
    try {
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      let bestArea = 0;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area > bestArea) {
          bestArea = area;
          if (bestCnt) bestCnt.delete();
          bestCnt = cnt;
        } else {
          cnt.delete();
        }
      }
      if (!bestCnt || bestArea < frameArea * 0.1 || bestArea > frameArea * 0.98) {
        return null;
      }

      const peri = cv.arcLength(bestCnt, true);
      let q: number[][] | null = null;
      for (const eps of [0.02, 0.03, 0.04, 0.05]) {
        cv.approxPolyDP(bestCnt, approx, eps * peri, true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          q = [];
          for (let r = 0; r < 4; r++) {
            q.push([approx.data32S[r * 2], approx.data32S[r * 2 + 1]]);
          }
          break;
        }
      }
      if (!q) {
        const rr = cv.minAreaRect(bestCnt);
        q = boxPoints(rr);
      }
      return { quad: orderQuad(q), area: bestArea };
    } catch {
      return null;
    } finally {
      if (bestCnt) bestCnt.delete();
      contours.delete();
      hierarchy.delete();
      approx.delete();
    }
  }

  function findReceiptQuad(cv: any, srcRGBA: any): number[][] | null {
    const gray = new cv.Mat();
    const rgb = new cv.Mat();
    const hsv = new cv.Mat();
    const chans = new cv.MatVector();
    const blur = new cv.Mat();
    const mask = new cv.Mat();
    const edges = new cv.Mat();
    const kBig = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(25, 25));
    const kSmall = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
    const candidates: { quad: number[][]; area: number }[] = [];
    let sat: any = null;
    try {
      const frameArea = srcRGBA.cols * srcRGBA.rows;
      cv.cvtColor(srcRGBA, gray, cv.COLOR_RGBA2GRAY);
      cv.cvtColor(srcRGBA, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      cv.split(hsv, chans);
      const s0 = chans.get(1);
      sat = s0.clone();
      s0.delete();
      chans.delete();

      cv.GaussianBlur(sat, blur, new cv.Size(7, 7), 0);
      cv.threshold(blur, mask, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
      cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kSmall);
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kBig);
      const m1 = quadFromMask(cv, mask, frameArea);
      if (m1) candidates.push(m1);

      cv.GaussianBlur(gray, blur, new cv.Size(7, 7), 0);
      cv.threshold(blur, mask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kBig);
      const m2 = quadFromMask(cv, mask, frameArea);
      if (m2) candidates.push(m2);

      cv.Canny(blur, edges, 50, 150);
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kSmall);
      const m3 = quadFromMask(cv, edges, frameArea);
      if (m3) candidates.push(m3);

      if (!candidates.length) return null;
      candidates.sort((x, y) => y.area - x.area);
      return candidates[0].quad;
    } catch {
      return null;
    } finally {
      if (sat) sat.delete();
      gray.delete();
      rgb.delete();
      hsv.delete();
      blur.delete();
      mask.delete();
      edges.delete();
      kBig.delete();
      kSmall.delete();
    }
  }

  function opencvUsable(): boolean {
    const cv = window.cv;
    if (!cv || typeof cv.Mat !== "function" || typeof cv.imread !== "function") {
      return false;
    }
    try {
      const m = new cv.Mat();
      m.delete();
      return true;
    } catch {
      return false;
    }
  }

  function detectInitialQuad(source: HTMLCanvasElement): number[][] | null {
    const cv = window.cv;
    if (!cv || typeof cv.imread !== "function") return null;
    const src = cv.imread(source);
    try {
      return findReceiptQuad(cv, src);
    } catch {
      return null;
    } finally {
      src.delete();
    }
  }

  function defaultQuad(w: number, h: number): number[][] {
    const mx = w * 0.05;
    const my = h * 0.04;
    return [
      [mx, my],
      [w - mx, my],
      [w - mx, h - my],
      [mx, h - my],
    ];
  }

  function warpQuadToCanvas(source: HTMLCanvasElement, q: number[][]): HTMLCanvasElement {
    const cv = window.cv;
    if (!cv || typeof cv.imread !== "function") {
      throw new Error("opencv-not-ready");
    }

    const src = cv.imread(source);
    let dst: any = null;
    let srcTri: any = null;
    let dstTri: any = null;
    let M: any = null;
    try {
      const [tl, tr, br, bl] = orderQuad(q);
      const W = Math.max(
        Math.hypot(br[0] - bl[0], br[1] - bl[1]),
        Math.hypot(tr[0] - tl[0], tr[1] - tl[1]),
      );
      const H = Math.max(
        Math.hypot(tr[0] - br[0], tr[1] - br[1]),
        Math.hypot(tl[0] - bl[0], tl[1] - bl[1]),
      );
      if (W < 10 || H < 10) {
        throw new Error("quad-too-small");
      }

      dst = new cv.Mat();
      srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1]]);
      dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
      M = cv.getPerspectiveTransform(srcTri, dstTri);
      cv.warpPerspective(
        src,
        dst,
        M,
        new cv.Size(Math.round(W), Math.round(H)),
        cv.INTER_LINEAR,
        cv.BORDER_CONSTANT,
        new cv.Scalar(255, 255, 255, 255),
      );
      const out = document.createElement("canvas");
      cv.imshow(out, dst);
      return out;
    } finally {
      src.delete();
      if (dst) dst.delete();
      if (srcTri) srcTri.delete();
      if (dstTri) dstTri.delete();
      if (M) M.delete();
    }
  }

  function cropQuadRectToCanvas(source: HTMLCanvasElement, q: number[][]): HTMLCanvasElement {
    const xs = q.map((p) => p[0]);
    const ys = q.map((p) => p[1]);
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxX = Math.min(source.width, Math.ceil(Math.max(...xs)));
    const maxY = Math.min(source.height, Math.ceil(Math.max(...ys)));
    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 10 || h < 10) throw new Error("quad-too-small");
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("no-2d-context");
    ctx.drawImage(source, minX, minY, w, h, 0, 0, w, h);
    return out;
  }

  // OpenCV.js（自動検知用、約8MBのWASM）を読み込む。読み込みが間に合わなければ
  // 自動検知なしの手動クロップにフォールバックする（confirmCrop内でcvReadyを見て判断）。
  function loadOpenCv() {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    const markReady = () => {
      if (cancelled) return;
      cvReadyRef.current = true;
      cvReady = true;
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    };

    if (opencvUsable()) {
      markReady();
      return () => {};
    }

    if (!document.getElementById("opencv-script")) {
      const script = document.createElement("script");
      script.id = "opencv-script";
      script.src = "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js";
      script.async = true;
      script.onload = () => {
        const cv = window.cv;
        if (cv && typeof cv.then === "function") {
          // ライブラリ実装によってはthenableだがPromise互換ではない（catchを持たない）ことがあるため、
          // 呼び出し自体もtry/catchで保護する。失敗してもpollによる実測チェックがフォールバックになる。
          try {
            Promise.resolve(cv).then(() => markReady(), () => {});
          } catch {
            /* pollのフォールバックに任せる */
          }
        } else if (cv) {
          cv["onRuntimeInitialized"] = () => markReady();
        }
      };
      script.onerror = () => {
        /* 読み込み失敗時は自動検知なしで手動クロップにフォールバックするため、ここでは何もしない */
      };
      document.body.appendChild(script);
    }

    poll = setInterval(() => {
      if (opencvUsable()) markReady();
    }, 300);

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
    };
  }

  $effect(() => {
    const cleanup = loadOpenCv();
    return cleanup;
  });

  // 渡されたFileを読み込み、四隅を検知して切り抜き調整パネルの初期状態を作る
  $effect(() => {
    let cancelled = false;
    status = "読み込み中…";
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      URL.revokeObjectURL(objectUrl);
      const full = document.createElement("canvas");
      full.width = img.naturalWidth;
      full.height = img.naturalHeight;
      full.getContext("2d")?.drawImage(img, 0, 0);

      const auto = cvReadyRef.current ? detectInitialQuad(full) : null;
      imgDims = { w: full.width, h: full.height };
      quad = auto ?? defaultQuad(full.width, full.height);
      autoDetected = !!auto;
      fullFrame = full;

      full.toBlob(
        (blob) => {
          if (cancelled) return;
          if (!blob) {
            status = "画像の読み込みに失敗しました";
            return;
          }
          if (adjustUrlRef.current) URL.revokeObjectURL(adjustUrlRef.current);
          const url = URL.createObjectURL(blob);
          adjustUrlRef.current = url;
          adjustUrl = url;
          status = auto ? "四隅を確認して切り抜き" : "四隅を合わせて切り抜き";
        },
        "image/jpeg",
        0.92,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      if (!cancelled) status = "画像の読み込みに失敗しました。別の画像でお試しください";
    };
    img.src = objectUrl;

    return () => {
      cancelled = true;
    };
  });

  // 調整画面：写真の4隅が全部画面に収まるよう表示サイズを計算
  $effect(() => {
    if (!imgDims.w || !imgDims.h) {
      dispSize = null;
      return;
    }
    const compute = () => {
      const el = imgAreaRef;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const footer = 120;
      const availH = Math.max(140, window.innerHeight - top - footer);
      const availW = el.clientWidth || window.innerWidth;
      const s = Math.min(availW / imgDims.w, availH / imgDims.h);
      dispSize = { w: Math.round(imgDims.w * s), h: Math.round(imgDims.h * s) };
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("orientationchange", compute);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("orientationchange", compute);
    };
  });

  // iOS Safariでは固定要素（position: fixed）の上に重なるモーダルを開いている間も
  // 背後のページがスクロールしてしまい、タップ位置がずれてボタンが反応しないように
  // 見えることがある。モーダル表示中は背景のスクロールを止める。
  $effect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  });

  onDestroy(() => {
    if (adjustUrlRef.current) URL.revokeObjectURL(adjustUrlRef.current);
  });

  function finish(out: HTMLCanvasElement) {
    out.toBlob(
      (blob) => {
        if (!blob) return;
        const croppedFile = new File([blob], file.name || "receipt.jpg", { type: "image/jpeg" });
        cleanupAdjust();
        onCaptured(croppedFile);
      },
      "image/jpeg",
      0.9,
    );
  }

  function cleanupAdjust() {
    if (adjustUrlRef.current) {
      URL.revokeObjectURL(adjustUrlRef.current);
      adjustUrlRef.current = null;
    }
    adjustUrl = null;
    quad = null;
    dragPos = null;
    fullFrame = null;
    imgDims = { w: 0, h: 0 };
  }

  function confirmCrop() {
    const full = fullFrame;
    if (!full || !quad) return;
    try {
      const out = cvReadyRef.current && opencvUsable() ? warpQuadToCanvas(full, quad) : cropQuadRectToCanvas(full, quad);
      finish(out);
    } catch {
      finish(full);
    }
  }

  function useFullFrame() {
    const full = fullFrame;
    if (!full) return;
    finish(full);
  }

  function pointerToImg(e: PointerEvent): number[] | null {
    const rect = dragRectRef.current ?? svgRef?.getBoundingClientRect() ?? null;
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const x = ((e.clientX - rect.left) / rect.width) * imgDims.w;
    const y = ((e.clientY - rect.top) / rect.height) * imgDims.h;
    return [Math.min(Math.max(x, 0), imgDims.w), Math.min(Math.max(y, 0), imgDims.h)];
  }

  function onCornerDown(e: PointerEvent, i: number) {
    e.preventDefault();
    draggingRef.current = i;
    dragRectRef.current = svgRef?.getBoundingClientRect() ?? null;
    const cur = quad?.[i];
    if (cur) dragPos = { x: cur[0], y: cur[1] };
    try {
      (e.target as Element)?.releasePointerCapture?.(e.pointerId);
      svgRef?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onCornerMove(e: PointerEvent) {
    if (draggingRef.current == null) return;
    const p = pointerToImg(e);
    if (!p) return;
    const idx = draggingRef.current;
    quad = quad ? quad.map((q, k) => (k === idx ? p : q)) : quad;
    dragPos = { x: p[0], y: p[1] };
  }

  function onCornerUp(e: PointerEvent) {
    draggingRef.current = null;
    dragRectRef.current = null;
    dragPos = null;
    try {
      svgRef?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function resetQuad() {
    if (imgDims.w && imgDims.h) quad = defaultQuad(imgDims.w, imgDims.h);
  }

  function handleClose() {
    cleanupAdjust();
    onClose();
  }
</script>

<div class="camera-overlay">
  <div class="camera-frame">
    <canvas bind:this={canvasRef} class="hidden"></canvas>

    {#if !adjustUrl}
      <div class="picker-panel">
        <p class="status-badge">{status}</p>
        <button type="button" class="close-btn" onclick={handleClose} aria-label="閉じる">✕</button>
      </div>
    {/if}

    {#if adjustUrl && quad}
      <div class="adjust-panel">
        <div class="adjust-header">
          <p>{autoDetected ? "四隅をレシートの角に合わせてください" : "四隅をドラッグして合わせてください"}</p>
          <button type="button" class="btn btn-secondary btn-sm" onclick={resetQuad}>枠をリセット</button>
        </div>

        <div bind:this={imgAreaRef} class="adjust-image-area">
          {#if dispSize}
            <div class="adjust-image-wrap" style={`width:${dispSize.w}px;height:${dispSize.h}px;`}>
              <img src={adjustUrl} alt="選択した画像" draggable="false" class="adjust-image" />
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <svg
                bind:this={svgRef}
                viewBox={`0 0 ${imgDims.w} ${imgDims.h}`}
                preserveAspectRatio="none"
                class="adjust-svg"
                onpointermove={onCornerMove}
                onpointerup={onCornerUp}
              >
                <polygon
                  points={quad.map((p) => p.join(",")).join(" ")}
                  fill="rgba(59,130,246,0.12)"
                  stroke="#3b82f6"
                  stroke-width={Math.max(imgDims.w, imgDims.h) / 240}
                  style="pointer-events: none;"
                />
                {#each quad as p, i (i)}
                  {@const R = Math.max(imgDims.w, imgDims.h)}
                  <circle cx={p[0]} cy={p[1]} r={R / 26} fill="rgba(59,130,246,0.2)" stroke="#ffffff" stroke-width={R / 260} style="pointer-events: none;" />
                  <circle cx={p[0]} cy={p[1]} r={R / 150} fill="#ef4444" style="pointer-events: none;" />
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle
                    cx={p[0]}
                    cy={p[1]}
                    r={R / 12}
                    fill="transparent"
                    style="pointer-events: all; cursor: grab;"
                    onpointerdown={(e) => onCornerDown(e, i)}
                  />
                {/each}
              </svg>
            </div>
          {/if}
        </div>

        <div class="adjust-actions">
          <button type="button" class="btn btn-secondary" onclick={handleClose}>キャンセル</button>
          <button type="button" class="btn btn-secondary" onclick={useFullFrame}>全体を使う</button>
          <button type="button" class="btn btn-primary adjust-confirm" onclick={confirmCrop}>切り抜く</button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .camera-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .camera-frame {
    position: relative;
    width: 100%;
    height: 100%;
    max-width: 480px;
    margin: 0 auto;
    background: #000;
    color: #fff;
    overflow: auto;
  }

  .hidden {
    display: none;
  }

  .picker-panel {
    position: relative;
    display: flex;
    height: 100%;
    align-items: center;
    justify-content: center;
  }

  .status-badge {
    position: absolute;
    left: var(--space-md);
    top: var(--space-md);
    z-index: 10;
    border-radius: 0.375rem;
    background: rgba(0, 0, 0, 0.7);
    padding: 0.25rem 0.75rem;
    font-size: 0.875rem;
    color: #fff;
    margin: 0;
  }

  .close-btn {
    position: absolute;
    right: var(--space-md);
    top: var(--space-md);
    z-index: 10;
    height: 2.25rem;
    width: 2.25rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    border: none;
    font-size: 1rem;
    line-height: 1;
  }

  .adjust-panel {
    background: #000;
    color: #fff;
  }

  .adjust-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
  }

  .adjust-header p {
    margin: 0;
    font-size: 0.875rem;
    color: #d1d5db;
  }

  .adjust-image-area {
    display: flex;
    width: 100%;
    justify-content: center;
    overflow: hidden;
  }

  .adjust-image-wrap {
    position: relative;
    user-select: none;
    touch-action: none;
  }

  .adjust-image {
    position: absolute;
    inset: 0;
    height: 100%;
    width: 100%;
    user-select: none;
  }

  .adjust-svg {
    position: absolute;
    inset: 0;
    height: 100%;
    width: 100%;
    touch-action: none;
  }

  .adjust-actions {
    display: flex;
    gap: var(--space-sm);
    padding: var(--space-md);
  }

  .adjust-actions .btn {
    flex: 1;
    padding: var(--space-sm) var(--space-xs);
  }

  .adjust-confirm {
    flex: 1.4;
  }
</style>
