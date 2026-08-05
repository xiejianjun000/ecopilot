export {}

declare global {
  interface Window {
    /** 后端 API 基础地址，由 Electron preload 或启动脚本注入 */
    __ECO_API_BASE__?: string
  }
}
