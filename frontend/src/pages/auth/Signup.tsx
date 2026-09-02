import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Eye, EyeOff, Zap, Users, BarChart3 } from 'lucide-react';

interface CountryOption {
  name: { common: string };
  cca2: string;
}

const COUNTRIES: CountryOption[] = [
  { name: { common: 'China' }, cca2: 'CN' },
  { name: { common: 'United States' }, cca2: 'US' },
  { name: { common: 'United Kingdom' }, cca2: 'GB' },
  { name: { common: 'Germany' }, cca2: 'DE' },
  { name: { common: 'France' }, cca2: 'FR' },
  { name: { common: 'Japan' }, cca2: 'JP' },
  { name: { common: 'South Korea' }, cca2: 'KR' },
  { name: { common: 'Singapore' }, cca2: 'SG' },
  { name: { common: 'Hong Kong' }, cca2: 'HK' },
  { name: { common: 'Australia' }, cca2: 'AU' },
  { name: { common: 'Canada' }, cca2: 'CA' },
  { name: { common: 'Switzerland' }, cca2: 'CH' },
  { name: { common: 'India' }, cca2: 'IN' },
];

const inputStyle = {
  width: '100%', height: '44px', backgroundColor: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
  padding: '0 14px', fontSize: '14px', color: 'rgba(255,255,255,0.9)',
  outline: 'none', transition: 'border-color 0.15s',
  fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif",
};

const labelStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '4px'
};

export function SignupPage() {
  const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [country, setCountry] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const { signup, isSigningUp, signupError } = useAuth();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password || !companyName || !country) {
      setFormError('请填写所有必填项');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('两次输入的密码不一致');
      return;
    }
    if (password.length < 8) {
      setFormError('密码至少需要 8 个字符');
      return;
    }
    setFormError('');
    signup({ email, password, company_name: companyName, country });
  };

  const errorMessage =
    formError ||
    (signupError as { response?: { data?: { error?: string } } })?.response?.data?.error ||
    '';

  const focusStyle = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.target.style.borderColor = 'rgba(194,113,58,0.6)';
  };
  const blurStyle = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.target.style.borderColor = 'rgba(255,255,255,0.1)';
  };

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
        className="hidden lg:flex w-[420px] flex-col justify-between p-12 flex-shrink-0 relative border-r"
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
            <h2 style={{ color: 'rgba(255,255,255,0.95)', fontSize: '28px', fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.02em' }}>
              几分钟内完成<br />企业工作空间配置
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px', marginTop: '14px', lineHeight: 1.7 }}>
              创建一个管理员账号，即可开始管理整个组织。
            </p>
          </div>

          <div className="space-y-4">
            {[
              { icon: Zap, text: '根据国家或地区自动识别本位币' },
              { icon: Users, text: '添加员工并分配直属经理' },
              { icon: BarChart3, text: '从第一天起保留完整审计轨迹' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <Icon style={{ color: '#C2713A', width: '15px', height: '15px', flexShrink: 0 }} />
                <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '13px' }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '12px' }}>
          创建后你将成为企业管理员
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8 relative overflow-y-auto">
        <div className="w-full max-w-[400px] py-8 space-y-7">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 lg:hidden">
            <div className="w-8 h-8 flex items-center justify-center" style={{ backgroundColor: '#C2713A', borderRadius: '4px' }}>
              <span style={{ color: '#fff', fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace", fontWeight: 700, fontSize: '11px' }}>EP</span>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>ExpensePilot</span>
          </div>

          <div>
            <h1 style={{ color: 'rgba(255,255,255,0.95)', fontSize: '28px', fontWeight: 600, letterSpacing: '-0.02em' }}>
              创建账号
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px', marginTop: '6px' }}>
              配置你的企业工作空间
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMessage && (
              <div style={{ backgroundColor: 'rgba(185,28,28,0.15)', border: '1px solid rgba(185,28,28,0.3)', color: '#FCA5A5', fontSize: '13px', padding: '12px 16px', borderRadius: '8px' }}>
                {errorMessage}
              </div>
            )}

            <div>
              <label style={labelStyle}>企业名称</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="例如：示例企业"
                style={inputStyle}
                onFocus={focusStyle}
                onBlur={blurStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>国家或地区</label>
              <div className="relative">
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  style={{
                    ...inputStyle,
                    appearance: 'none',
                    paddingRight: '36px',
                    cursor: 'pointer',
                  }}
                  onFocus={focusStyle}
                  onBlur={blurStyle}
                >
                  <option value="" disabled style={{ backgroundColor: '#1a1a20' }}>
                    请选择国家或地区
                  </option>
                  {COUNTRIES.map((c) => (
                    <option key={c.cca2} value={c.name.common} style={{ backgroundColor: '#1a1a20' }}>
                      {regionNames.of(c.cca2) || c.name.common}
                    </option>
                  ))}
                </select>
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px', marginTop: '4px' }}>
                系统将自动识别企业本位币
              </p>
            </div>

            <div>
              <label style={labelStyle}>管理员邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="请输入管理员邮箱"
                autoComplete="email"
                style={inputStyle}
                onFocus={focusStyle}
                onBlur={blurStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>密码</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 8 个字符"
                  style={{ ...inputStyle, paddingRight: '44px' }}
                  onFocus={focusStyle}
                  onBlur={blurStyle}
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

            <div>
              <label style={labelStyle}>确认密码</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入密码"
                style={inputStyle}
                onFocus={focusStyle}
                onBlur={blurStyle}
              />
            </div>

            <button
              type="submit"
              disabled={isSigningUp}
              className="w-full flex items-center justify-center gap-2 transition-all"
              style={{
                height: '46px', backgroundColor: isSigningUp ? 'rgba(194,113,58,0.6)' : '#C2713A',
                color: '#fff', border: 'none', borderRadius: '8px',
                fontSize: '14px', fontWeight: 600, cursor: isSigningUp ? 'not-allowed' : 'pointer',
                letterSpacing: '-0.01em', fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif",
                marginTop: '4px',
              }}
            >
              {isSigningUp ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : '创建账号'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: '13px', color: 'rgba(255,255,255,0.35)' }}>
            已有账号？{' '}
            <Link to="/login" style={{ color: '#C2713A', fontWeight: 500, textDecoration: 'none' }}>
              登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
