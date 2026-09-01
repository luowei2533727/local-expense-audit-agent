import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  PlusCircle,
  Users,
  CheckSquare,
  Settings,
  ClipboardList,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Bot,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuthStore } from '../../stores/authStore';
import { useState } from 'react';

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  roles: string[];
}

const navItems: NavItem[] = [
  { label: '工作台', path: '/employee', icon: LayoutDashboard, roles: ['EMPLOYEE', 'MANAGER', 'ADMIN'] },
  { label: '提交报销', path: '/employee/submit', icon: PlusCircle, roles: ['EMPLOYEE', 'MANAGER', 'ADMIN'] },
  { label: '我的报销', path: '/employee/expenses', icon: FileText, roles: ['EMPLOYEE', 'MANAGER', 'ADMIN'] },
  { label: '待我审批', path: '/manager/approvals', icon: CheckSquare, roles: ['MANAGER', 'ADMIN'] },
  { label: '管理概览', path: '/admin', icon: BarChart3, roles: ['ADMIN'] },
  { label: '全部报销', path: '/admin/expenses', icon: ClipboardList, roles: ['ADMIN'] },
  { label: '用户管理', path: '/admin/users', icon: Users, roles: ['ADMIN'] },
  { label: '审批规则', path: '/admin/rules', icon: Settings, roles: ['ADMIN'] },
  { label: 'PI Agent 实验室', path: '/admin/agent-lab', icon: Bot, roles: ['ADMIN'] },
];

export function Sidebar() {
  const { user } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);

  const filteredItems = navItems.filter((item) => user && item.roles.includes(user.role));

  return (
    <aside
      style={{ backgroundColor: '#111116', borderRight: '1px solid rgba(255,255,255,0.06)', fontFamily: "'DM Sans', sans-serif" }}
      className={cn(
        'fixed left-0 top-0 h-full z-20 transition-all duration-200 flex flex-col',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo */}
      <div
        className={cn('flex items-center gap-3 p-4', collapsed && 'justify-center')}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div
          className="w-8 h-8 flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: '#C2713A', borderRadius: '4px' }}
        >
          <span style={{ color: '#fff', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '11px' }}>EP</span>
        </div>
        {!collapsed && (
          <div>
            <p style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600, fontSize: '14px', letterSpacing: '-0.01em', lineHeight: 1.2 }}>ExpensePilot</p>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px', marginTop: '1px' }}>智能报销平台</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 flex flex-col overflow-y-auto">
        {filteredItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/employee' || item.path === '/admin'}
            className={cn('flex items-center gap-3 py-2.5 text-sm font-medium transition-colors mx-2 rounded', collapsed && 'justify-center px-2')}
            style={({ isActive }) => ({
              color: isActive ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.4)',
              backgroundColor: isActive ? 'rgba(255,255,255,0.07)' : 'transparent',
              borderLeft: isActive && !collapsed ? '2px solid #C2713A' : '2px solid transparent',
              paddingLeft: collapsed ? '8px' : isActive ? '10px' : '12px',
            })}
            title={collapsed ? item.label : undefined}
          >
            {({ isActive }) => (
              <>
                <item.icon style={{ width: '16px', height: '16px', flexShrink: 0, color: isActive ? '#C2713A' : 'rgba(255,255,255,0.4)' }} />
                {!collapsed && <span>{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '8px' }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn('flex items-center gap-2 rounded px-3 py-2 text-sm w-full transition-colors', collapsed && 'justify-center')}
          style={{ color: 'rgba(255,255,255,0.3)', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.7)'; (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.05)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.3)'; (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
        >
          {collapsed ? <ChevronRight style={{ width: '15px', height: '15px' }} /> : (
            <>
              <ChevronLeft style={{ width: '15px', height: '15px' }} />
              <span style={{ fontSize: '13px' }}>收起菜单</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
