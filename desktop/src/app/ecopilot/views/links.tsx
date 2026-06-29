/** 政务平台 — 卡片网格，点击弹出登录 */
import { useState } from 'react'
import { Icon } from '../../../components/ui/icon'

interface Platform {
  id: string; name: string; icon: string; url: string
  desc: string; auto: boolean; loginMode: string
}

const PLATFORMS: Platform[] = [
  { id:'permit', name:'全国排污许可证管理信息平台', icon:'file-text', url:'permit.mee.gov.cn', desc:'许可证申领/变更/延续/执行报告/台账', auto:true, loginMode:'CAS+验证码' },
  { id:'auto-monitor', name:'重点排污单位自动监控平台', icon:'monitor', url:'wryjc.cnemc.cn', desc:'CEMS在线监测/小时数据/日均值', auto:false, loginMode:'SSO账号' },
  { id:'pollution-monitor', name:'全国污染源监测信息管理平台', icon:'activity', url:'wryjc.cnemc.cn', desc:'自行监测数据公开/手工监测/比对', auto:false, loginMode:'SSO账号' },
  { id:'self-monitor', name:'自行监测信息公开平台', icon:'globe', url:'permit.mee.gov.cn', desc:'企业自行监测数据对社会公开', auto:false, loginMode:'已有账号' },
  { id:'carbon-trade', name:'全国碳排放权交易市场', icon:'trending-up', url:'www.carbonx.cn', desc:'碳配额交易/履约/CCER', auto:false, loginMode:'注册+UKey' },
  { id:'carbon-report', name:'全国碳排放报送系统', icon:'cloud', url:'114.251.10.30', desc:'碳排放数据报送/核算/核查', auto:false, loginMode:'已有账号' },
  { id:'solid-waste', name:'全国固体废物管理信息系统', icon:'recycle', url:'gfgl.mee.gov.cn', desc:'一般固废台账/申报/管理', auto:false, loginMode:'已有账号' },
  { id:'hazard-waste', name:'危险废物转移管理平台', icon:'truck', url:'-', desc:'危废跨省转移/联单管理/备案', auto:false, loginMode:'已有账号' },
  { id:'eia-credit', name:'环境影响评价信用平台', icon:'file-description', url:'xypt.china-eia.com', desc:'环评文件编制/信用记录/编制单位', auto:false, loginMode:'已有账号' },
  { id:'completion-accept', name:'建设项目竣工环保验收平台', icon:'clipboard', url:'-', desc:'验收报告公示/专家意见备案', auto:false, loginMode:'已有账号' },
  { id:'enforcement', name:'环境执法监管平台', icon:'shield', url:'-', desc:'整改任务/行政处罚记录', auto:false, loginMode:'已有账号' },
  { id:'credit-eval', name:'企业环境信用评价系统', icon:'check-square', url:'-', desc:'环境信用等级/信用修复申请', auto:false, loginMode:'已有账号' },
  { id:'emission-rights', name:'排污权交易平台', icon:'dollar', url:'-', desc:'排污权交易/租赁/变更', auto:false, loginMode:'已有账号' },
  { id:'cleaner-prod', name:'清洁生产管理平台', icon:'tool', url:'-', desc:'清洁生产审核/验收/公示', auto:false, loginMode:'已有账号' },
  { id:'tax', name:'环保税申报系统', icon:'credit-card', url:'etax.chinatax.gov.cn', desc:'环保税计算/申报/缴纳', auto:false, loginMode:'电子税务局' },
]

function LoginDialog({ platform, onClose }: { platform: Platform; onClose: () => void }) {
  const [step, setStep] = useState<'idle'|'connecting'|'success'|'error'>('idle')
  const [username, setUsername] = useState('yuanbin')
  const [password, setPassword] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [captchaImg, setCaptchaImg] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [msg, setMsg] = useState('')

  const startConnect = async () => {
    if (!platform.auto) { setMsg('请手动登录'); setStep('error'); return }
    setStep('connecting'); setMsg('启动浏览器中...')
    try {
      const r = await fetch('http://localhost:8002/api/permit/login/start', { method:'POST' })
      const d = await r.json()
      setSessionId(d.session_id)
      setCaptchaImg(d.captcha_base64 ? 'data:image/jpeg;base64,'+d.captcha_base64 : '')
      setStep('idle'); setMsg('')
    } catch(e:any) { setMsg('连接失败'); setStep('error') }
  }

  const doLogin = async () => {
    if (!username||!password||!captcha) { setMsg('请填写完整'); return }
    setStep('connecting'); setMsg('登录中...')
    try {
      const r = await fetch('http://localhost:8002/api/permit/login/submit', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({session_id:sessionId,username,password,captcha}),
      })
      const d = await r.json()
      if (d.ok) { setStep('success'); setMsg('登录成功') }
      else {
        setMsg(d.detail||'失败'); setStep('error')
        if ((d.detail||'').includes('验证码')) {
          const r2=await fetch('http://localhost:8002/api/permit/captcha/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:sessionId})})
          const d2=await r2.json()
          if(d2.captcha_base64) setCaptchaImg('data:image/jpeg;base64,'+d2.captcha_base64)
          setCaptcha('')
        }
      }
    } catch(e:any) { setMsg('异常'); setStep('error') }
  }

  const {auto,name}=platform

  return (
    <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.35)',display:'flex',alignItems:'center',justifyContent:'center',padding:24}} onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
      <div style={{background:'#fff',borderRadius:14,width:'100%',maxWidth:380,boxShadow:'0 8px 32px rgba(0,0,0,0.12)',overflow:'hidden'}}>
        <div style={{padding:'18px 22px 0',display:'flex',alignItems:'flex-start',justifyContent:'space-between'}}>
          <div><div style={{fontSize:15,fontWeight:700}}>{name}</div><div style={{fontSize:11,color:'#999',marginTop:3}}>{platform.url}</div></div>
          <button onClick={onClose} style={{width:26,height:26,borderRadius:6,border:'none',background:'#f3f4f6',cursor:'pointer',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center',color:'#999'}}>✕</button>
        </div>
        <div style={{padding:'14px 22px 18px'}}>
          {!auto ? (
            <div style={{textAlign:'center',padding:'10px 0'}}>
              <p style={{fontSize:13,color:'#6B7280',marginBottom:10}}>{msg||'此平台暂未接入自动登录'}</p>
              {platform.url!=='-'&&<button onClick={()=>{window.open('https://'+platform.url,'_blank');onClose()}} style={{padding:'7px 18px',borderRadius:7,border:'none',background:'#059669',color:'#fff',fontSize:12,cursor:'pointer'}}>浏览器打开</button>}
            </div>
          ) : step==='connecting' ? (
            <div style={{textAlign:'center',padding:'16px 0'}}>
              <div style={{width:24,height:24,borderRadius:'50%',border:'3px solid #e5e7eb',borderTopColor:'#059669',animation:'s 0.7s linear infinite',margin:'0 auto 10px'}}/>
              <p style={{fontSize:13,color:'#6B7280'}}>{msg}</p>
              <style>{'@keyframes s{to{transform:rotate(360deg)}}'}</style>
            </div>
          ) : step==='success' ? (
            <div style={{textAlign:'center',padding:'10px 0'}}>
              <div style={{width:40,height:40,borderRadius:'50%',background:'#d1fae5',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 8px',fontSize:20}}>✅</div>
              <p style={{fontSize:13,color:'#374151',marginBottom:8}}>{msg}</p>
              <button onClick={onClose} style={{padding:'6px 18px',borderRadius:7,border:'none',background:'#059669',color:'#fff',fontSize:12,cursor:'pointer'}}>返回</button>
            </div>
          ) : (
            <div>
              <div style={{marginBottom:8}}><label style={{fontSize:10,color:'#999',display:'block',marginBottom:2}}>账号</label>
                <input type="text" value={username} onChange={e=>setUsername(e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:7,border:'1px solid #e5e7eb',fontSize:13,outline:'none',boxSizing:'border-box'}} /></div>
              <div style={{marginBottom:8}}><label style={{fontSize:10,color:'#999',display:'block',marginBottom:2}}>密码</label>
                <input type="password" value={password} onChange={e=>setPassword(e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:7,border:'1px solid #e5e7eb',fontSize:13,outline:'none',boxSizing:'border-box'}} /></div>
              <div style={{marginBottom:8}}><label style={{fontSize:10,color:'#999',display:'block',marginBottom:2}}>验证码</label>
                <div style={{display:'flex',gap:6}}>
                  <input type="text" value={captcha} onChange={e=>setCaptcha(e.target.value)} placeholder="输入验证码" maxLength={6} style={{flex:1,padding:'7px 10px',borderRadius:7,border:'1px solid #e5e7eb',fontSize:13,outline:'none'}} />
                  {captchaImg&&<img src={captchaImg} alt="验证码" style={{height:34,borderRadius:5,cursor:'pointer',border:'1px solid #e5e7eb'}} onClick={async()=>{const r=await fetch('http://localhost:8002/api/permit/captcha/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:sessionId})});const d=await r.json();if(d.captcha_base64)setCaptchaImg('data:image/jpeg;base64,'+d.captcha_base64);setCaptcha('')}}/>}
                </div></div>
              {msg&&<div style={{fontSize:11,color:'#dc2626',marginBottom:6,padding:'5px 8px',borderRadius:5,background:'#fef2f2'}}>{msg}</div>}
              <div style={{display:'flex',gap:6}}>
                <button onClick={startConnect} style={{flex:1,padding:'8px 0',borderRadius:7,border:'1px solid #e5e7eb',background:'#fff',fontSize:12,cursor:'pointer',color:'#6B7280'}}>刷新</button>
                <button onClick={doLogin} style={{flex:2,padding:'8px 0',borderRadius:7,border:'none',background:'#059669',color:'#fff',fontSize:12,fontWeight:500,cursor:'pointer'}}>登录</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{'@keyframes s{to{transform:rotate(360deg)}}'}</style>
    </div>
  )
}

export function LinksView() {
  const [loginPlatform, setLoginPlatform] = useState<Platform|null>(null)
  return (
    <div style={{padding:'20px 24px',overflowY:'auto',height:'100%',background:'#f7f7f7',fontFamily:"-apple-system,'PingFang SC','Microsoft YaHei',sans-serif"}}>
      <div style={{marginBottom:14}}>
        <h2 style={{fontSize:18,fontWeight:700,display:'flex',alignItems:'center',gap:8,color:'#1D2129'}}>
          <Icon name="globe" size={18} /> 政务平台
        </h2>
        <p style={{fontSize:12,color:'#999',marginTop:3}}>{PLATFORMS.length} 个平台 · {PLATFORMS.filter(p=>p.auto).length} 个已接入自动登录，点击卡片一键登录</p>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:12}}>
        {PLATFORMS.map((p,i)=>(
          <div key={i} onClick={()=>setLoginPlatform(p)}
            style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'20px 16px 18px',borderRadius:11,
              border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',transition:'all 0.15s',gap:10,minHeight:120,
              boxShadow:'0 1px 2px rgba(0,0,0,0.03)'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#059669';e.currentTarget.style.boxShadow='0 2px 8px rgba(5,150,105,0.12)';e.currentTarget.style.transform='translateY(-1px)'}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#e5e7eb';e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.03)';e.currentTarget.style.transform='none'}}
          >
            <div style={{width:48,height:48,borderRadius:9,
              background:p.auto?'#ecfdf5':p.url!=='-'?'#fefce8':'#f3f4f6',
              display:'flex',alignItems:'center',justifyContent:'center'}}>
              <Icon name={p.icon} size={16} color={p.auto?'#059669':p.url!=='-'?'#d97706':'#999'}/>
            </div>
            <div style={{textAlign:'center',lineHeight:1.2}}>
              <div style={{fontSize:13,fontWeight:600,color:'#374151'}}>{p.name}</div>
              <div style={{fontSize:10,color:'#999',marginTop:4}}>{p.desc}</div>
            </div>
            <div style={{fontSize:9,padding:'2px 6px',borderRadius:3,background:p.auto?'#ecfdf5':'#f3f4f6',color:p.auto?'#059669':'#999',whiteSpace:'nowrap'}}>
              {p.auto?'一键登录':p.loginMode}
            </div>
          </div>
        ))}
      </div>
      {loginPlatform&&<LoginDialog platform={loginPlatform} onClose={()=>setLoginPlatform(null)}/>}
    </div>
  )
}
