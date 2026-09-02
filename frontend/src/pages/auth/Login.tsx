import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Eye, EyeOff, Sparkles, ShieldCheck, Globe } from 'lucide-react';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');

  const { login, isLoggingIn, loginError } = useAuth();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setFormError('请填写邮箱和密码');
      return;
    }
    setFormError('');
    login({ email, password });
  };

  const errorMessage =
    formError ||
    (loginError as { response?: { data?: { error?: string } } })?.response?.data?.error ||
    '';

  return (
    <div
      className="min-h-screen flex"
      style={{ backgroundColor: '#0C0C10', fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif" }}
    >
      {/* Ambient glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(194,113,58,0.18) 0%, transparent 70%)',
        }}
      />

      {/* Left panel */}
      <div
        className="hidden lg:flex w-[480px] flex-col justify-between p-12 flex-shrink-0 relative border-r"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#C2713A', borderRadius: '4px' }}
          >
            <span style={{ color: '#fff', fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace", fontWeight: 700, fontSize: '11px' }}>EP</span>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600, fontSize: '15px', letterSpacing: '-0.01em' }}>
            ExpensePilot
          </span>
        </div>

        <div className="space-y-10">
          <div>
            <h2 style={{ color: 'rgba(255,255,255,0.95)', fontSize: '32px', fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.02em' }}>
              面向现代团队的<br />智能报销管理平台
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px', marginTop: '16px', lineHeight: 1.7, maxWidth: '320px' }}>
              从提交到审批，全流程自动化、可审计，并贴合企业真实工作方式。
            </p>
          </div>

          <div className="space-y-4">
            {[
              { icon: Sparkles, text: '通过本地 Ollama 自动识别票据' },
              { icon: ShieldCheck, text: '可配置的多级审批流程' },
              { icon: Globe, text: '支持多币种与实时汇率换算' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <Icon style={{ color: '#C2713A', width: '15px', height: '15px', flexShrink: 0 }} />
                <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '13px' }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '12px' }}>企业级安全 · 数据本地优先</p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8 relative">
        <div className="w-full max-w-[400px] space-y-8">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 lg:hidden">
            <div className="w-8 h-8 flex items-center justify-center" style={{ backgroundColor: '#C2713A', borderRadius: '4px' }}>
              <span style={{ color: '#fff', fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace", fontWeight: 700, fontSize: '11px' }}>EP</span>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>ExpensePilot</span>
          </div>

          <div>
            <h1 style={{ color: 'rgba(255,255,255,0.95)', fontSize: '28px', fontWeight: 600, letterSpacing: '-0.02em' }}>
              登录
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px', marginTop: '6px' }}>
              欢迎回到你的工作空间
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMessage && (
              <div style={{ backgroundColor: 'rgba(185,28,28,0.15)', border: '1px solid rgba(185,28,28,0.3)', color: '#FCA5A5', fontSize: '13px', padding: '12px 16px', borderRadius: '8px' }}>
                {errorMessage}
              </div>
            )}

            <div className="space-y-1">
              <label style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 500, display: 'block' }}>
                邮箱
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="请输入企业邮箱"
                autoComplete="email"
                style={{
                  width: '100%', height: '44px', backgroundColor: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
                  padding: '0 14px', fontSize: '14px', color: 'rgba(255,255,255,0.9)',
                  outline: 'none', transition: 'border-color 0.15s',
                  fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif",
                }}
                onFocus={(e) => { e.target.style.borderColor = 'rgba(194,113,58,0.6)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
              />
            </div>

            <div className="space-y-1">
              <label style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 500, display: 'block' }}>
                密码
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  style={{
                    width: '100%', height: '44px', backgroundColor: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
                    padding: '0 44px 0 14px', fontSize: '14px', color: 'rgba(255,255,255,0.9)',
                    outline: 'none', transition: 'border-color 0.15s',
                    fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif",
                  }}
                  onFocus={(e) => { e.target.style.borderColor = 'rgba(194,113,58,0.6)'; }}
                  onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full flex items-center justify-center gap-2 transition-all"
              style={{
                height: '46px', backgroundColor: isLoggingIn ? 'rgba(194,113,58,0.6)' : '#C2713A',
                color: '#fff', border: 'none', borderRadius: '8px',
                fontSize: '14px', fontWeight: 600, cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                letterSpacing: '-0.01em', fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif",
                marginTop: '8px',
              }}
            >
              {isLoggingIn ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : '登录'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: '13px', color: 'rgba(255,255,255,0.35)' }}>
            第一次使用 ExpensePilot？{' '}
            <Link to="/signup" style={{ color: '#C2713A', fontWeight: 500, textDecoration: 'none' }}>
              创建账号
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
