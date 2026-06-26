// EcoPilot 本地类型定义（替代 @hermes/shared）
export type ConnectionState = 'connecting' | 'open' | 'closed' | 'error'

export interface GatewayEvent {
  type: string
  data?: any
  session_id?: string
}
