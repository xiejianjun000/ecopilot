/**
 * 全国生态环境政务平台 URL 配置
 *
 * 覆盖排污许可、监测、执法、碳交易、固废、环评等核心业务平台。
 */

export interface GovernmentPlatform {
  /** 平台名称 */
  name: string
  /** 登录页面 URL */
  loginUrl: string
  /** 主页面 URL */
  homeUrl: string
  /** 平台图标 */
  icon: string
  /** 平台类别 */
  category: PlatformCategory
  /** govmcp 对接状态 */
  govmcpReady: boolean
  /** 登录方式 */
  loginMethod: 'account' | 'ukey' | 'ca' | 'sms'
}

export type PlatformCategory =
  | 'permit'       // 排污许可
  | 'monitoring'   // 环境监测
  | 'carbon'       // 碳排放
  | 'solid-waste'  // 固废管理
  | 'eia'          // 环境影响评价
  | 'enforcement'  // 执法监管
  | 'disclosure'   // 信息公开
  | 'other'        // 其他

/** 核心政务平台清单 */
export const CORE_PLATFORMS: GovernmentPlatform[] = [
  {
    name: '全国排污许可证管理信息平台',
    loginUrl: 'https://permit.mee.gov.cn/cas/login?service=http%3A%2F%2Fpermit.mee.gov.cn%2FpermitExt%2F',
    homeUrl: 'https://permit.mee.gov.cn/permitExt/',
    icon: '📋',
    category: 'permit',
    govmcpReady: false,
    loginMethod: 'account',  // 账号密码 + 图形验证码 + RSA加密
  },
  {
    name: '全国污染源监测信息管理与共享平台',
    loginUrl: 'https://wryjc.cnemc.cn/',
    homeUrl: 'https://wryjc.cnemc.cn/',
    icon: '📊',
    category: 'monitoring',
    govmcpReady: false,
    loginMethod: 'account',
  },
  {
    name: '全国碳排放权交易市场',
    loginUrl: 'https://www.cneeex.com/',
    homeUrl: 'https://www.cneeex.com/',
    icon: '🏭',
    category: 'carbon',
    govmcpReady: false,
    loginMethod: 'account',
  },
  {
    name: '全国固体废物管理信息系统',
    loginUrl: 'https://gufei.mee.gov.cn/',
    homeUrl: 'https://gufei.mee.gov.cn/',
    icon: '🗑️',
    category: 'solid-waste',
    govmcpReady: false,
    loginMethod: 'account',
  },
  {
    name: '环境影响评价信用平台',
    loginUrl: 'https://xz.china-eia.com/',
    homeUrl: 'https://xz.china-eia.com/',
    icon: '📝',
    category: 'eia',
    govmcpReady: false,
    loginMethod: 'account',
  },
  {
    name: '全国环境信息公开平台',
    loginUrl: 'https://www.mee.gov.cn/',
    homeUrl: 'https://www.mee.gov.cn/',
    icon: '📢',
    category: 'disclosure',
    govmcpReady: false,
    loginMethod: 'account',
  },
  {
    name: '生态环境部行政处罚案件办理系统',
    loginUrl: 'https://xzcf.mee.gov.cn/',
    homeUrl: 'https://xzcf.mee.gov.cn/',
    icon: '⚖️',
    category: 'enforcement',
    govmcpReady: false,
    loginMethod: 'account',
  },
]

/** 排污许可平台登录 API 详情 */
export const PERMIT_PLATFORM_LOGIN = {
  loginUrl: 'https://permit.mee.gov.cn/cas/login?service=http%3A%2F%2Fpermit.mee.gov.cn%2FpermitExt%2F',
  /** 登录表单字段 */
  formFields: {
    username: { selector: '#username', type: 'text' },
    password: { selector: '#password', type: 'password', encrypt: 'rsa' },
    captcha: { selector: '#verCode', type: 'text' },
  },
  /** 隐藏字段（CSRF Token） */
  hiddenFields: {
    lt: '#lt',           // CAS login ticket
    execution: '#execution',
    eventId: '#_eventId',
    authSessionKey: '#AUTH_SESSION_KEY',
  },
  /** RSA 加密参数 */
  rsaParams: {
    modulusSelector: '#hid_modulus',
    exponentSelector: '#hid_exponent',
  },
  /** 验证码 */
  captcha: {
    imageSelector: '#kaptchaImage',
    refreshUrl: 'kaptcha.jpg',
    refreshMethod: () => `kaptcha.jpg?${Math.floor(Math.random() * 100)}`,
  },
  /** 提交按钮 */
  submitButton: '#loginBtn',
} as const
