<script lang="ts">
  /**
   * レシート画像を矩形で切り抜くコンポーネント。
   * 以前はOpenCV.js（約8MBのWASM）で四隅を自動検知していたが、実機で「画面は出るが
   * ボタン・ドラッグが一切反応しない」という不具合が解消できなかったため、
   * OpenCVを含む複雑な実装をやめ、Canvas 2D APIのみで完結する矩形トリミングに置き換えた。
   * 外部ライブラリ・WASM読み込みは一切行わない。
   *
   * 撮影・画像選択自体は呼び出し元の既存のファイル選択欄（<input type="file">）が担い、
   * このコンポーネントは選ばれたFileを受け取ってトリミングUIを出すだけに専念する。
   * confirmCrop()/useFullFrame()で確定した画像はonCaptured(file)で呼び出し元にJPEG Fileとして渡す。
   */
  import { onDestroy } from "svelte";

  let { file, onCaptured, onClose }: { file: File; onCaptured: (file: File) => void; onClose: () => void } = $props();

  let stageRef = $state<HTMLDivElement | null>(null);

  let status = $state("読み込み中…");
  let imageUrl = $state<string | null>(null);
  let imgDims = $state({ w: 0, h: 0 });

  // 切り抜き矩形。0〜1の比率で保持する（表示サイズに依存させないため）
  let rect = $state({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });

  const imageUrlRef = { current: null as string | null };
  /** 選択された元画像を描画したcanvas（切り抜き前）。$stateにする必要はない */
  let fullFrame: HTMLCanvasElement | null = null;

  type DragMode = "move" | "nw" | "ne" | "sw" | "se" | null;
  const dragRef = {
    mode: null as DragMode,
    startPointerX: 0,
    startPointerY: 0,
    startRect: { x: 0, y: 0, w: 0, h: 0 },
    stageRect: null as DOMRect | null,
  };

  const MIN_SIZE = 0.05;

  // 渡されたFileを画像として読み込み、切り抜き矩形の初期値を作る
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
      const full = document.createElement("canvas");
      full.width = img.naturalWidth;
      full.height = img.naturalHeight;
      full.getContext("2d")?.drawImage(img, 0, 0);
      fullFrame = full;
      imgDims = { w: full.width, h: full.height };
      rect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };

      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = objectUrl;
      imageUrl = objectUrl;
      status = "枠をドラッグして切り抜き範囲を合わせてください";
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

  onDestroy(() => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
  });

  function finish(out: HTMLCanvasElement) {
    out.toBlob(
      (blob) => {
        if (!blob) return;
        const croppedFile = new File([blob], file.name || "receipt.jpg", { type: "image/jpeg" });
        cleanup();
        onCaptured(croppedFile);
      },
      "image/jpeg",
      0.9,
    );
  }

  function cleanup() {
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = null;
    }
    imageUrl = null;
    fullFrame = null;
    imgDims = { w: 0, h: 0 };
  }

  function confirmCrop() {
    const full = fullFrame;
    if (!full) return;
    const x = Math.round(rect.x * full.width);
    const y = Math.round(rect.y * full.height);
    const w = Math.round(rect.w * full.width);
    const h = Math.round(rect.h * full.height);
    if (w < 10 || h < 10) {
      finish(full);
      return;
    }
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) {
      finish(full);
      return;
    }
    ctx.drawImage(full, x, y, w, h, 0, 0, w, h);
    finish(out);
  }

  function useFullFrame() {
    const full = fullFrame;
    if (!full) return;
    finish(full);
  }

  function clamp(v: number, min: number, max: number): number {
    return Math.min(Math.max(v, min), max);
  }

  function startDrag(e: PointerEvent, mode: DragMode) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.mode = mode;
    dragRef.startPointerX = e.clientX;
    dragRef.startPointerY = e.clientY;
    dragRef.startRect = { ...rect };
    dragRef.stageRect = stageRef?.getBoundingClientRect() ?? null;
    try {
      (e.currentTarget as Element)?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onDragMove(e: PointerEvent) {
    if (!dragRef.mode || !dragRef.stageRect) return;
    const { width, height } = dragRef.stageRect;
    if (width === 0 || height === 0) return;

    const dx = (e.clientX - dragRef.startPointerX) / width;
    const dy = (e.clientY - dragRef.startPointerY) / height;
    const start = dragRef.startRect;

    if (dragRef.mode === "move") {
      const x = clamp(start.x + dx, 0, 1 - start.w);
      const y = clamp(start.y + dy, 0, 1 - start.h);
      rect = { ...start, x, y };
      return;
    }

    let { x, y, w, h } = start;
    if (dragRef.mode === "nw" || dragRef.mode === "sw") {
      const newX = clamp(start.x + dx, 0, start.x + start.w - MIN_SIZE);
      w = start.x + start.w - newX;
      x = newX;
    }
    if (dragRef.mode === "ne" || dragRef.mode === "se") {
      const newW = clamp(start.w + dx, MIN_SIZE, 1 - start.x);
      w = newW;
    }
    if (dragRef.mode === "nw" || dragRef.mode === "ne") {
      const newY = clamp(start.y + dy, 0, start.y + start.h - MIN_SIZE);
      h = start.y + start.h - newY;
      y = newY;
    }
    if (dragRef.mode === "sw" || dragRef.mode === "se") {
      const newH = clamp(start.h + dy, MIN_SIZE, 1 - start.y);
      h = newH;
    }
    rect = { x, y, w, h };
  }

  function endDrag(e: PointerEvent) {
    dragRef.mode = null;
    dragRef.stageRect = null;
    try {
      (e.currentTarget as Element)?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function resetRect() {
    rect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
  }

  function handleClose() {
    cleanup();
    onClose();
  }
</script>

<div class="crop-overlay">
  <div class="crop-frame">
    {#if !imageUrl}
      <div class="picker-panel">
        <p class="status-badge">{status}</p>
        <button type="button" class="close-btn" onclick={handleClose} aria-label="閉じる">✕</button>
      </div>
    {:else}
      <div class="adjust-panel">
        <div class="adjust-header">
          <p>{status}</p>
          <button type="button" class="btn btn-secondary btn-sm" onclick={resetRect}>枠をリセット</button>
        </div>

        <div class="adjust-image-area">
          <div bind:this={stageRef} class="stage" style={`aspect-ratio: ${imgDims.w} / ${imgDims.h};`}>
            <img src={imageUrl} alt="選択した画像" draggable="false" class="stage-image" />

            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="crop-box"
              style={`left:${rect.x * 100}%; top:${rect.y * 100}%; width:${rect.w * 100}%; height:${rect.h * 100}%;`}
              onpointerdown={(e) => startDrag(e, "move")}
              onpointermove={onDragMove}
              onpointerup={endDrag}
              onpointercancel={endDrag}
            >
              <div class="grid-line grid-v" style="left: 33.333%;"></div>
              <div class="grid-line grid-v" style="left: 66.666%;"></div>
              <div class="grid-line grid-h" style="top: 33.333%;"></div>
              <div class="grid-line grid-h" style="top: 66.666%;"></div>

              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="handle handle-nw"
                onpointerdown={(e) => startDrag(e, "nw")}
                onpointermove={onDragMove}
                onpointerup={endDrag}
                onpointercancel={endDrag}
              ></div>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="handle handle-ne"
                onpointerdown={(e) => startDrag(e, "ne")}
                onpointermove={onDragMove}
                onpointerup={endDrag}
                onpointercancel={endDrag}
              ></div>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="handle handle-sw"
                onpointerdown={(e) => startDrag(e, "sw")}
                onpointermove={onDragMove}
                onpointerup={endDrag}
                onpointercancel={endDrag}
              ></div>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="handle handle-se"
                onpointerdown={(e) => startDrag(e, "se")}
                onpointermove={onDragMove}
                onpointerup={endDrag}
                onpointercancel={endDrag}
              ></div>
            </div>
          </div>
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
  .crop-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: #000;
  }

  .crop-frame {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    max-width: 480px;
    margin: 0 auto;
    background: #000;
    color: #fff;
  }

  .picker-panel {
    position: relative;
    display: flex;
    flex: 1;
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
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: #000;
    color: #fff;
  }

  .adjust-header {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
  }

  .adjust-header p {
    margin: 0;
    font-size: 0.8125rem;
    color: #d1d5db;
  }

  .adjust-image-area {
    display: flex;
    flex: 1;
    min-height: 0;
    width: 100%;
    align-items: center;
    justify-content: center;
    padding: var(--space-sm);
    overflow: hidden;
  }

  .stage {
    position: relative;
    width: 100%;
    max-height: 100%;
    user-select: none;
    touch-action: none;
  }

  .stage-image {
    display: block;
    width: 100%;
    height: auto;
    max-height: 100%;
    user-select: none;
    pointer-events: none;
  }

  .crop-box {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid #3b82f6;
    background: rgba(59, 130, 246, 0.12);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
    cursor: move;
    touch-action: none;
  }

  .grid-line {
    position: absolute;
    background: rgba(255, 255, 255, 0.4);
    pointer-events: none;
  }

  .grid-v {
    top: 0;
    bottom: 0;
    width: 1px;
  }

  .grid-h {
    left: 0;
    right: 0;
    height: 1px;
  }

  .handle {
    position: absolute;
    width: 28px;
    height: 28px;
    touch-action: none;
  }

  .handle::after {
    content: "";
    position: absolute;
    inset: 8px;
    border-radius: 999px;
    background: #fff;
    border: 2px solid #3b82f6;
  }

  .handle-nw {
    top: -14px;
    left: -14px;
    cursor: nwse-resize;
  }

  .handle-ne {
    top: -14px;
    right: -14px;
    cursor: nesw-resize;
  }

  .handle-sw {
    bottom: -14px;
    left: -14px;
    cursor: nesw-resize;
  }

  .handle-se {
    bottom: -14px;
    right: -14px;
    cursor: nwse-resize;
  }

  .adjust-actions {
    display: flex;
    flex: 0 0 auto;
    gap: var(--space-sm);
    padding: var(--space-md);
    padding-bottom: max(var(--space-md), env(safe-area-inset-bottom));
  }

  .adjust-actions .btn {
    flex: 1;
    padding: var(--space-sm) var(--space-xs);
  }

  .adjust-confirm {
    flex: 1.4;
  }
</style>
