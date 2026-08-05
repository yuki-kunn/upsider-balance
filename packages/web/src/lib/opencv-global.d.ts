/** OpenCV.js (jsDelivr CDNから実行時ロード) をwindow.cvとして参照するためのアンビエント宣言 */
export {};

declare global {
  interface Window {
    cv: any;
  }
}
