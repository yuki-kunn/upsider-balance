<script lang="ts">
  /**
   * カメラでレシートを撮影し、四隅を自動検知・手動調整して切り抜くコンポーネント。
   * https://github.com/Asuma09/receipt-uploader のCameraCapture.tsxを移植したもの。
   * 元実装はNotion送信・複数枚バッチ・事業カテゴリ選択まで含むが、このプロジェクトは
   * 「1件ずつ登録してAIが解析する」設計のため、撮影〜切り抜きの単体フローのみ移植する。
   * 切り抜き確定後はonCaptured(file)で呼び出し元にJPEG Fileを渡す。
   */
  import { onDestroy } from "svelte";

  type Mode = "camera" | "adjust";

  let { onCaptured, onClose }: { onCaptured: (file: File) => void; onClose: () => void } = $props();

  let videoRef = $state<HTMLVideoElement | null>(null);
  let canvasRef = $state<HTMLCanvasElement | null>(null);
  let svgRef = $state<SVGSVGElement | null>(null);
  let imgAreaRef = $state<HTMLDivElement | null>(null);

  let status = $state("起動中…");
  let started = $state(false);
  /** getUserMediaが成功し、実際に映像の再生まで進んだか。シャッターボタンの表示条件に使う */
  let cameraLive = $state(false);
  let mode = $state<Mode>("camera");
  let cvReady = $state(false);

  let adjustUrl = $state<string | null>(null);
  let quad = $state<number[][] | null>(null);
  let imgDims = $state({ w: 0, h: 0 });
  let autoDetected = $state(false);
  let dragPos = $state<{ x: number; y: number } | null>(null);
  let dispSize = $state<{ w: number; h: number } | null>(null);

  const stableFramesRef = { current: 0 };
  const capturingRef = { current: false };
  const cvReadyRef = { current: false };
  const modeRef = { current: "camera" as Mode };
  const cooldownUntilRef = { current: 0 };
  const fullFrameRef = { current: null as HTMLCanvasElement | null };
  const adjustUrlRef = { current: null as string | null };
  const draggingRef = { current: null as number | null };
  const dragRectRef = { current: null as DOMRect | null };

  let stream: MediaStream | null = null;

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

  // OpenCV.js を読み込み（レシートの自動検知とクロップに使用）。
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
        if (!cancelled) {
          status = "画像処理エンジンの読込に失敗しました（通信環境をご確認ください）";
        }
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

  // OpenCV.js(約8MBのWASM)の読み込みはモーダルを開いた瞬間ではなく、
  // 実際にカメラを起動した後に遅延させる。低速回線・低メモリ環境で
  // モーダルを開いた直後の操作性（ボタンのタップ等）に影響しないようにするため。
  let openCvCleanup: (() => void) | null = null;
  $effect(() => {
    if (!started) return;
    openCvCleanup = loadOpenCv();
    return () => {
      openCvCleanup?.();
      openCvCleanup = null;
    };
  });

  $effect(() => {
    modeRef.current = mode;
  });

  // 調整画面：写真の4隅が全部画面に収まるよう表示サイズを計算
  $effect(() => {
    if (mode !== "adjust" || !imgDims.w || !imgDims.h) {
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
    stream?.getTracks().forEach((t) => t.stop());
  });

  async function handleStart() {
    // 「もう一度試す」での再試行に備え、前回状態をリセットする
    cameraLive = false;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }

    // iOS Safariではプライベートブラウジングや一部のWebView（アプリ内ブラウザ）で
    // navigator.mediaDevices自体がundefinedになることがある。この場合getUserMediaの
    // 呼び出しで即座に例外になるはずだが、念のため事前にチェックして明示的なメッセージを出す。
    if (!navigator.mediaDevices?.getUserMedia) {
      started = true;
      status =
        "このブラウザ・画面ではカメラを利用できません。Safariで開いているか、設定でカメラへのアクセスを許可しているかご確認ください（アプリ内ブラウザでは利用できない場合があります）";
      return;
    }

    started = true;
    status = "カメラ起動中…";

    // getUserMediaの許可プロンプトを無視/放置するとPromiseが返らずここで止まり続けるため、
    // 一定時間で諦めてエラー表示に切り替える（「起動中…」のまま固まって見えるのを防ぐ）。
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      status = "カメラの起動がタイムアウトしました。画面上部の許可ダイアログを確認するか、再度お試しください";
    }, 15000);

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      clearTimeout(timeoutId);
      if (timedOut) {
        // タイムアウト表示後に許可された場合、ユーザーが状況を把握できるよう一旦ストリームは止める
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
        return;
      }
      if (videoRef) {
        videoRef.srcObject = stream;
        await videoRef.play();
        status = "レシートを写してください";
        cameraLive = true;
        requestAnimationFrame(loop);
      }
    } catch (e: any) {
      clearTimeout(timeoutId);
      const name = e?.name ?? "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        status =
          "カメラへのアクセスが許可されていません。ブラウザの設定（Safari: 設定アプリ→Safari→カメラ、またはサイトのアドレスバー横のアイコン）から許可してください";
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        status = "利用できるカメラが見つかりませんでした";
      } else {
        status = `カメラ起動失敗: ${e?.message ?? e}`;
      }
    }
  }

  function loop() {
    if (modeRef.current === "camera") detectReceipt();
    setTimeout(() => requestAnimationFrame(loop), 400);
  }

  function detectReceipt() {
    if (capturingRef.current) return;
    if (Date.now() < cooldownUntilRef.current) return;
    if (!cvReadyRef.current) return;
    const video = videoRef;
    const canvas = canvasRef;
    const cv = window.cv;
    if (!video || !canvas || !cv) return;
    if (!video.videoWidth) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    const edges = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 60, 180);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let detected = false;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      const area = cv.contourArea(approx);
      if (approx.rows === 4 && area > src.cols * src.rows * 0.1) {
        const rect = cv.boundingRect(approx);
        const ratio = rect.height / rect.width;
        if (ratio > 1.2 && ratio < 4.5) detected = true;
      }
      approx.delete();
      cnt.delete();
    }

    src.delete();
    gray.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();

    if (detected) {
      stableFramesRef.current += 1;
      status = `検知中… ${stableFramesRef.current}/3`;
      if (stableFramesRef.current >= 3) {
        stableFramesRef.current = 0;
        capture();
      }
    } else {
      stableFramesRef.current = 0;
      status = "レシートを写してください";
    }
  }

  function capture() {
    if (capturingRef.current) return;
    const video = videoRef;
    const canvas = canvasRef;
    if (!video || !canvas || !video.videoWidth) return;
    capturingRef.current = true;
    status = "切り取り中…";

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      capturingRef.current = false;
      return;
    }
    ctx.drawImage(video, 0, 0);

    const full = document.createElement("canvas");
    full.width = canvas.width;
    full.height = canvas.height;
    full.getContext("2d")?.drawImage(canvas, 0, 0);
    fullFrameRef.current = full;

    const auto = cvReadyRef.current ? detectInitialQuad(full) : null;
    imgDims = { w: full.width, h: full.height };
    quad = auto ?? defaultQuad(full.width, full.height);
    autoDetected = !!auto;

    full.toBlob(
      (blob) => {
        if (!blob) {
          capturingRef.current = false;
          return;
        }
        if (adjustUrlRef.current) URL.revokeObjectURL(adjustUrlRef.current);
        const url = URL.createObjectURL(blob);
        adjustUrlRef.current = url;
        adjustUrl = url;
        mode = "adjust";
        modeRef.current = "adjust";
        status = auto ? "四隅を確認して切り抜き" : "四隅を合わせて切り抜き";
        capturingRef.current = false;
      },
      "image/jpeg",
      0.9,
    );
  }

  function finish(out: HTMLCanvasElement) {
    out.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], "receipt.jpg", { type: "image/jpeg" });
        cleanupAdjust();
        onCaptured(file);
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
    fullFrameRef.current = null;
  }

  function confirmCrop() {
    const full = fullFrameRef.current;
    if (!full || !quad) return;
    try {
      const out = cvReadyRef.current && opencvUsable() ? warpQuadToCanvas(full, quad) : cropQuadRectToCanvas(full, quad);
      finish(out);
    } catch {
      finish(full);
    }
  }

  function useFullFrame() {
    const full = fullFrameRef.current;
    if (!full) return;
    finish(full);
  }

  function cancelAdjust() {
    cleanupAdjust();
    stableFramesRef.current = 0;
    cooldownUntilRef.current = Date.now() + 1500;
    mode = "camera";
    modeRef.current = "camera";
    status = "レシートを写してください";
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
    stream?.getTracks().forEach((t) => t.stop());
    cleanupAdjust();
    onClose();
  }
</script>

<div class="camera-overlay">
  <div class="camera-frame">
    {#if !started}
      <button type="button" class="btn btn-primary start-btn" onclick={handleStart}>カメラを開始</button>
    {/if}

    <video
      bind:this={videoRef}
      playsinline
      muted
      class="camera-video"
      class:hidden={mode !== "camera"}
    ></video>
    <canvas bind:this={canvasRef} class="hidden"></canvas>

    {#if mode === "camera"}
      <p class="status-badge">{status}</p>
      {#if started && !cameraLive}
        <button type="button" class="btn btn-secondary retry-btn" onclick={handleStart}>もう一度試す</button>
      {/if}
      {#if cameraLive && !cvReady}
        <p class="status-badge status-badge-sub">自動シャッター準備中（手動で撮影・切り抜きできます）</p>
      {/if}
      {#if cameraLive}
        <button type="button" class="shutter-btn" aria-label="撮影" onclick={capture}></button>
      {/if}
      <button type="button" class="close-btn" onclick={handleClose} aria-label="閉じる">✕</button>
    {/if}

    {#if mode === "adjust" && adjustUrl && quad}
      <div class="adjust-panel">
        <div class="adjust-header">
          <p>{autoDetected ? "四隅をレシートの角に合わせてください" : "四隅をドラッグして合わせてください"}</p>
          <button type="button" class="btn btn-secondary btn-sm" onclick={resetQuad}>枠をリセット</button>
        </div>

        <div bind:this={imgAreaRef} class="adjust-image-area">
          {#if dispSize}
            <div class="adjust-image-wrap" style={`width:${dispSize.w}px;height:${dispSize.h}px;`}>
              <img src={adjustUrl} alt="撮影画像" draggable="false" class="adjust-image" />
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
          <button type="button" class="btn btn-secondary" onclick={cancelAdjust}>撮り直す</button>
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

  .start-btn {
    position: absolute;
    inset: 0;
    z-index: 10;
    margin: auto;
    height: 4rem;
    width: 14rem;
    top: 50%;
    transform: translateY(-50%);
  }

  .camera-video {
    width: 100%;
    background: #000;
    display: block;
  }

  .hidden {
    display: none;
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

  .status-badge-sub {
    top: calc(var(--space-md) + 2.5rem);
    background: rgba(0, 0, 0, 0.6);
    font-size: 0.75rem;
  }

  .retry-btn {
    position: absolute;
    inset: 0;
    z-index: 10;
    margin: auto;
    height: 3rem;
    width: 12rem;
    top: 60%;
    transform: translateY(-50%);
  }

  .shutter-btn {
    position: absolute;
    bottom: var(--space-lg);
    left: 50%;
    z-index: 10;
    height: 4rem;
    width: 4rem;
    transform: translateX(-50%);
    border-radius: 999px;
    border: 4px solid #fff;
    background: rgba(255, 255, 255, 0.3);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .shutter-btn:active {
    background: rgba(255, 255, 255, 0.7);
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
