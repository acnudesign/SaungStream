import React, { useState, useEffect, createContext, useContext, useRef } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { 
  LayoutDashboard, 
  Film, 
  ListMusic, 
  Radio, 
  Calendar, 
  Settings, 
  LogOut, 
  Menu, 
  X,
  Plus,
  Trash2,
  Play,
  Square,
  Clock,
  AlertCircle,
  CheckCircle2,
  Upload,
  ChevronRight,
  ChevronLeft,
  MoreVertical,
  Users,
  HardDrive,
  Cpu,
  Activity,
  ArrowUp,
  ArrowDown,
  ShieldCheck,
  UserPlus,
  Sun,
  Moon,
  Palette,
  Bell,
  Globe,
  Info,
  RefreshCw,
  Search,
  Download,
  Edit2,
  BookOpen,
  Maximize2,
  ExternalLink
} from "lucide-react";
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  getDay, 
  getDate, 
  addMonths, 
  subMonths, 
  isAfter, 
  isBefore, 
  startOfDay, 
  subDays,
  addDays,
  startOfWeek,
  endOfWeek,
  isSameDay,
  parseISO
} from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ThemeContext = createContext<{
  theme: 'light' | 'dark';
  toggleTheme: () => void;
} | null>(null);

const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme] = useState<'dark'>('dark');

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  const toggleTheme = () => {};

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
          <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-200 dark:border-slate-800">
            <div className="w-16 h-16 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-2xl flex items-center justify-center mb-6">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-4">Something went wrong</h2>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              The application encountered an unexpected error. Please try refreshing the page.
            </p>
            <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-xl text-xs text-slate-500 dark:text-slate-400 overflow-auto max-h-40 mb-6">
              {this.state.error?.message || String(this.state.error)}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const fetchJson = async (url: string, fallback: any = []) => {
  try {
    const res = await fetch(url);
    const contentType = res.headers.get("content-type");
    if (!res.ok || !contentType || !contentType.includes("application/json")) {
      return fallback;
    }
    const data = await res.json();
    return Array.isArray(data) ? data : (typeof data === 'object' && !Array.isArray(fallback) ? data : fallback);
  } catch (err) {
    console.error(`Fetch error for ${url}:`, err);
    return fallback;
  }
};

// --- Auth Context ---
const AuthContext = createContext<{
  user: any;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  loading: boolean;
} | null>(null);

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/me");
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setUser(data.user);
      }
    } catch (err) {
      console.error("Auth check failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const login = async (username: string, password: string) => {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      throw new Error("Server returned an invalid response. Please try again.");
    }

    const data = await res.json();
    if (data.success) {
      setUser(data.user);
    } else {
      throw new Error(data.error || "Login failed");
    }
  };

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    setUser(null);
  };

  const refreshUser = async () => {
    await checkAuth();
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => useContext(AuthContext)!;

// --- Components ---

const SidebarItem = ({ to, icon: Icon, label, active, onClick }: { to: string, icon: any, label: string, active?: boolean, onClick?: () => void }) => (
  <Link 
    to={to} 
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
      active 
        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200 dark:shadow-none" 
        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400"
    )}
  >
    <Icon size={20} className={cn("transition-transform duration-200 group-hover:scale-110", active ? "text-white" : "text-slate-400 dark:text-slate-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400")} />
    <span className="font-bold text-sm">{label}</span>
  </Link>
);

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useContext(ThemeContext)!;
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [serverTime, setServerTime] = useState<string>("");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{latestVersion: string, changelog: string[]} | null>(null);

  const fetchTime = async () => {
    try {
      const res = await fetch('/api/system/time');
      if (res.ok) {
        const data = await res.json();
        setServerTime(data.formatted || data.currentTime);
      }
    } catch (err) {
      console.error("Failed to fetch server time:", err);
    }
  };

  const checkUpdate = async () => {
    try {
      const res = await fetch('/api/system/update-check');
      if (res.ok) {
        const data = await res.json();
        setUpdateAvailable(data.updateAvailable);
        setUpdateInfo({
          latestVersion: data.latestVersion,
          changelog: data.changelog || []
        });
      }
    } catch (err) {
      console.error("Failed to check for updates:", err);
    }
  };

  useEffect(() => {
    fetchTime();
    checkUpdate();
    const interval = setInterval(fetchTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      const res = await fetch('/api/system/update', { method: 'POST' });
      if (res.ok) {
        alert("Application updated successfully! The server will restart.");
        window.location.reload();
      }
    } catch (err) {
      console.error("Update failed:", err);
      alert("Update failed. Please check logs.");
    } finally {
      setIsUpdating(false);
      setShowUpdateModal(false);
    }
  };

  if (!user) return <Navigate to="/login" />;

  const navItems = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/media", icon: Film, label: "Media Library" },
    { to: "/playlists", icon: ListMusic, label: "Playlists" },
    { to: "/streams", icon: Radio, label: "Streams" },
    { to: "/guide", icon: BookOpen, label: "Guide" },
    { to: "/settings", icon: Settings, label: "Settings" },
  ];

  if (user.role === 'admin') {
    navItems.push({ to: "/users", icon: Users, label: "User Management" });
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex flex-col w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 sticky top-0 h-screen">
        <div className="p-8">
          <div className="flex items-center mb-10 px-4">
            <Link to="/" className="flex items-center">
              <img 
                src="/assets/logo.svg" 
                alt="SaungStream Logo" 
                className="h-10 w-auto object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "https://picsum.photos/seed/saungstream/300/100";
                }}
              />
            </Link>
          </div>
          
          <nav className="space-y-1">
            {navItems.map((item) => (
              <SidebarItem 
                key={item.to} 
                {...item} 
                active={location.pathname === item.to}
              />
            ))}
          </nav>
        </div>

        <div className="mt-auto p-8 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400 font-bold overflow-hidden">
              {user.profile_picture ? (
                <img src={user.profile_picture} alt={user.username} className="w-full h-full object-cover" />
              ) : (
                user.username[0].toUpperCase()
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{user.username}</p>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">{user.role}</p>
            </div>
          </div>
          <button 
            onClick={logout}
            className="flex items-center gap-3 w-full p-3 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all font-bold text-sm"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 pb-20 lg:pb-0">
        {/* Header */}
        <header className="h-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              <Menu size={24} />
            </button>
            <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-sm font-medium">
              <Clock size={16} />
              <span className="font-mono">{serverTime || "Loading..." }</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <button 
              onClick={() => setShowUpdateModal(true)}
              className={cn(
                "p-2 rounded-lg relative transition-all",
                updateAvailable 
                  ? "text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20" 
                  : "text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              )}
              title="Check for updates"
            >
              <Bell size={20} />
              {updateAvailable && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white dark:border-slate-900 animate-pulse"></span>
              )}
            </button>
            <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block"></div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-4 lg:p-10">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex justify-around items-center h-16 z-40 px-2">
        {navItems.slice(0, 5).map((item) => (
          <Link 
            key={item.to}
            to={item.to}
            className={cn(
              "flex flex-col items-center gap-1 p-2 rounded-lg transition-all",
              location.pathname === item.to 
                ? "text-indigo-600 dark:text-indigo-400" 
                : "text-slate-400 dark:text-slate-500"
            )}
          >
            <item.icon size={20} />
            <span className="text-[10px] font-bold">{item.label.split(' ')[0]}</span>
          </Link>
        ))}
      </nav>

      {/* Update Modal */}
      <AnimatePresence>
        {showUpdateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <Bell className="text-indigo-600" size={24} />
                  System Update
                </h3>
                <button onClick={() => setShowUpdateModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6">
                <div className="flex items-center justify-between mb-6 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl">
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider mb-1">Status</p>
                    <p className="text-sm font-bold dark:text-white">
                      {updateAvailable ? "New version available" : "System is up to date"}
                    </p>
                  </div>
                  <button 
                    onClick={checkUpdate}
                    className="flex items-center gap-2 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    <RefreshCw size={14} className={cn(isUpdating && "animate-spin")} />
                    Check Now
                  </button>
                </div>

                {updateInfo && updateInfo.changelog.length > 0 && (
                  <div className="mb-6">
                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider mb-3">Changelog v{updateInfo.latestVersion}</p>
                    <ul className="space-y-2">
                      {updateInfo.changelog.map((item, i) => (
                        <li key={i} className="text-sm text-slate-600 dark:text-slate-300 flex items-start gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0"></span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowUpdateModal(false)}
                    className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                  >
                    Close
                  </button>
                  {updateAvailable && (
                    <button 
                      onClick={handleUpdate}
                      disabled={isUpdating}
                      className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                    >
                      {isUpdating ? "Updating..." : "Update Now"}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 lg:hidden"
            />
            <motion.aside 
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              className="fixed top-0 left-0 bottom-0 w-80 bg-white dark:bg-slate-900 z-50 lg:hidden flex flex-col"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-10 px-4">
                  <Link to="/" className="flex items-center" onClick={() => setIsMobileMenuOpen(false)}>
                    <img 
                      src="/assets/logo.svg" 
                      alt="SaungStream Logo" 
                      className="h-10 w-auto object-contain"
                    />
                  </Link>
                  <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-slate-400">
                    <X size={24} />
                  </button>
                </div>
                
                <nav className="space-y-1">
                  {navItems.map((item) => (
                    <SidebarItem 
                      key={item.to} 
                      {...item} 
                      active={location.pathname === item.to}
                      onClick={() => setIsMobileMenuOpen(false)}
                    />
                  ))}
                </nav>
              </div>

              <div className="mt-auto p-8 border-t border-slate-100 dark:border-slate-800">
                <button 
                  onClick={logout}
                  className="flex items-center gap-3 w-full p-3 text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all font-bold text-sm"
                >
                  <LogOut size={18} />
                  Sign Out
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Pages ---

const LoginPage = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { login, user } = useAuth();
  const navigate = useNavigate();

  if (user) return <Navigate to="/" />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(username, password);
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6 transition-colors duration-200">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white dark:bg-slate-900 p-10 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl shadow-indigo-100 dark:shadow-none"
      >
        <div className="text-center mb-10">
          <div className="flex justify-center mb-6">
            <img 
              src="/assets/logo.svg" 
              alt="SaungStream Logo" 
              className="h-16 w-auto object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).src = "https://picsum.photos/seed/saungstream/300/100";
              }}
            />
          </div>
          <p className="text-slate-500 dark:text-slate-400 font-medium italic">Bismillah semoga berkah ikhtiar ini</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-bold rounded-xl flex items-center gap-2">
              <AlertCircle size={18} />
              {error}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700 dark:text-slate-300 ml-1">Username</label>
            <input 
              type="text" 
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-5 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
              placeholder="Enter your username"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700 dark:text-slate-300 ml-1">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-5 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
              placeholder="Enter your password"
              required
            />
          </div>
          <button 
            type="submit"
            className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Sign In
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const Dashboard = () => {
  const [stats, setStats] = useState({ streams: [], media: [], logs: [] });
  const [systemStats, setSystemStats] = useState<any>(null);
  const [updateSuccess, setUpdateSuccess] = useState<any>(null);
  const { user } = useAuth();

  const fetchData = async () => {
    try {
      const [streams, media, logs, settings] = await Promise.all([
        fetchJson("/api/streams", []),
        fetchJson("/api/media", []),
        fetchJson("/api/logs", []),
        fetchJson("/api/system/settings", {})
      ]);
      
      setStats({ 
        streams: Array.isArray(streams) ? streams : [], 
        media: Array.isArray(media) ? media : [], 
        logs: Array.isArray(logs) ? logs : [] 
      });

      if (settings.last_update_success) {
        try {
          setUpdateSuccess(JSON.parse(settings.last_update_success));
        } catch (e) {}
      }

      if (user && user.role === 'admin') {
        const sys = await fetchJson("/api/system/stats", null);
        setSystemStats(sys);
      }
    } catch (err) {
      console.error("Dashboard: Fetch error", err);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const dismissUpdateBanner = async () => {
    try {
      await fetch("/api/system/settings/clear-update-flag", { method: 'POST' });
      setUpdateSuccess(null);
    } catch (e) {}
  };

  const activeStreams = Array.isArray(stats.streams) ? stats.streams.filter((s: any) => s.status === 'live') : [];
  const mediaCount = Array.isArray(stats.media) ? stats.media.length : 0;
  const logsList = Array.isArray(stats.logs) ? stats.logs : [];

  return (
    <div className="space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400">Overview of your streaming system</p>
        </div>
        <button 
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
        >
          <RefreshCw size={16} />
          Refresh Data
        </button>
      </header>

      <AnimatePresence>
        {updateSuccess && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-indigo-600 rounded-2xl p-6 text-white shadow-xl shadow-indigo-200 dark:shadow-none relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-4">
              <button onClick={dismissUpdateBanner} className="text-white/60 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <CheckCircle2 size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold mb-1">System Updated Successfully!</h3>
                <p className="text-white/80 text-sm mb-3">
                  SaungStream has been updated to the latest version from GitHub.
                </p>
                <div className="bg-black/20 p-3 rounded-lg border border-white/10">
                  <p className="text-xs font-mono text-white/90 leading-relaxed">
                    <span className="text-indigo-200 font-bold">Commit:</span> {updateSuccess.message}
                  </p>
                  <p className="text-[10px] text-white/50 mt-1 font-mono">Hash: {updateSuccess.hash}</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {user.role === 'admin' && systemStats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                <Cpu size={24} />
              </div>
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full">{systemStats.cpu.usage}%</span>
            </div>
            <p className="text-slate-500 text-sm font-medium">CPU Usage</p>
            <div className="w-full bg-slate-100 h-2 rounded-full mt-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${systemStats.cpu.usage}%` }}></div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
                <Activity size={24} />
              </div>
              <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-1 rounded-full">{systemStats.memory.usage}%</span>
            </div>
            <p className="text-slate-500 text-sm font-medium">Memory (RAM)</p>
            <p className="text-xs text-slate-400 mt-1">{systemStats.memory.total - systemStats.memory.free}GB / {systemStats.memory.total}GB</p>
            <div className="w-full bg-slate-100 h-2 rounded-full mt-2">
              <div className="bg-purple-600 h-2 rounded-full" style={{ width: `${systemStats.memory.usage}%` }}></div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-orange-50 text-orange-600 rounded-xl">
                <HardDrive size={24} />
              </div>
              <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-full">{systemStats.disk.usage}%</span>
            </div>
            <p className="text-slate-500 text-sm font-medium">Disk Usage</p>
            <p className="text-xs text-slate-400 mt-1">{systemStats.disk.total - systemStats.disk.free}GB / {systemStats.disk.total}GB</p>
            <div className="w-full bg-slate-100 h-2 rounded-full mt-2">
              <div className="bg-orange-600 h-2 rounded-full" style={{ width: `${systemStats.disk.usage}%` }}></div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                <Activity size={24} />
              </div>
            </div>
            <p className="text-slate-500 text-sm font-medium">Internet Speed</p>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-1 text-emerald-600">
                <ArrowDown size={14} />
                <span className="text-sm font-bold">{systemStats.network.download} Mbps</span>
              </div>
              <div className="flex items-center gap-1 text-blue-600">
                <ArrowUp size={14} />
                <span className="text-sm font-bold">{systemStats.network.upload} Mbps</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Radio size={24} />
            </div>
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded-full">LIVE NOW</span>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Active Streams</p>
          <h2 className="text-3xl font-bold text-slate-800 dark:text-white">{activeStreams.length}</h2>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <Film size={24} />
            </div>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Total Media Files</p>
          <h2 className="text-3xl font-bold text-slate-800 dark:text-white">{mediaCount}</h2>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-xl">
              <Calendar size={24} />
            </div>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Scheduled Today</p>
          <h2 className="text-3xl font-bold text-slate-800 dark:text-white">0</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-800 dark:text-white">Recent Activity</h2>
              <Activity size={20} className="text-slate-400" />
            </div>
            <div className="space-y-4">
              {logsList.length > 0 ? logsList.slice(0, 10).map((log: any) => (
                <div key={log.id} className="flex items-start gap-4 p-4 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border border-transparent hover:border-slate-100 dark:hover:border-slate-800">
                  <div className={cn(
                    "p-2 rounded-lg",
                    log.action?.includes('error') ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" : 
                    log.action?.includes('Success') ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400" :
                    "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400"
                  )}>
                    {log.action?.includes('Success') ? <CheckCircle2 size={16} /> : <Clock size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{log.action}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{log.message || log.details}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">{new Date(log.timestamp).toLocaleString()}</span>
                      {user.role === 'admin' && (
                        <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 px-1.5 py-0.5 rounded uppercase">User: {log.username}</span>
                      )}
                    </div>
                  </div>
                </div>
              )) : (
                <div className="py-10 text-center text-slate-400">
                  <Activity size={32} className="mx-auto mb-2 opacity-20" />
                  <p>No recent activity logs</p>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-6">System Status</h2>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">FFmpeg Engine</span>
                </div>
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-full">ONLINE</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Database</span>
                </div>
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-full">CONNECTED</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Storage System</span>
                </div>
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-full">READY</span>
              </div>
            </div>
          </section>

          <section className="bg-indigo-600 p-8 rounded-2xl shadow-xl shadow-indigo-200 dark:shadow-none text-white">
            <h2 className="text-xl font-bold mb-2">Need Help?</h2>
            <p className="text-indigo-100 text-sm mb-6 opacity-80">Check out our documentation for advanced streaming tips and tricks.</p>
            <Link to="/guide" className="block w-full py-3 bg-white text-indigo-600 rounded-xl font-bold hover:bg-indigo-50 transition-all text-center">
              View Guide
            </Link>
          </section>
        </div>
      </div>

    </div>
  );
};

const MediaLibrary = () => {
  const [media, setMedia] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<any>(null);

  const [uploadProgress, setUploadProgress] = useState(0);

  const fetchMedia = async () => {
    const data = await fetchJson("/api/media");
    setMedia(data);
  };

  useEffect(() => {
    fetchMedia();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadProgress(0);
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/upload", true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentComplete);
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        fetchMedia();
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          alert(data.error || "Upload failed");
        } catch (e) {
          alert("Upload failed");
        }
      }
      setUploading(false);
      setUploadProgress(0);
    };

    xhr.onerror = () => {
      alert("Upload failed");
      setUploading(false);
      setUploadProgress(0);
    };

    xhr.send(formData);
  };

  const handleDownload = async () => {
    if (!downloadUrl) return;
    setIsDownloading(true);
    try {
      const res = await fetch("/api/media/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: downloadUrl })
      });
      if (res.ok) {
        setDownloadUrl("");
        fetchMedia();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsDownloading(false);
    }
  };

  const deleteMedia = async (id: number) => {
    if (!confirm("Are you sure you want to delete this media?")) return;
    await fetch(`/api/media/${id}`, { method: "DELETE" });
    fetchMedia();
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Media Library</h1>
          <p className="text-slate-500 dark:text-slate-400">Manage your video assets</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <input 
              type="text" 
              placeholder="Paste video URL (Drive, Dropbox, Mega...)" 
              value={downloadUrl}
              onChange={e => setDownloadUrl(e.target.value)}
              className="px-4 py-2 outline-none text-sm w-48 md:w-64 bg-transparent dark:text-white"
            />
            <button 
              onClick={handleDownload}
              disabled={isDownloading || !downloadUrl}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              {isDownloading ? "..." : <Plus size={18} />}
            </button>
          </div>
          <label className={cn(
            "flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all cursor-pointer",
            uploading && "opacity-50 cursor-not-allowed"
          )}>
            <Upload size={20} />
            {uploading ? "Uploading..." : "Upload Video"}
            <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} accept="video/*" />
          </label>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {uploading && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden group">
            <div className="aspect-video bg-slate-100 dark:bg-slate-800 relative overflow-hidden flex items-center justify-center">
              <div className="absolute inset-0 bg-indigo-600/20 backdrop-blur-sm flex flex-col items-center justify-center p-4">
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden mb-2">
                  <div 
                    className="bg-indigo-600 h-full transition-all duration-300" 
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span className="text-indigo-600 dark:text-indigo-400 font-black text-xl">{uploadProgress}%</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-bold uppercase tracking-widest">Uploading...</span>
              </div>
            </div>
            <div className="p-4 opacity-50">
              <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-1/2"></div>
            </div>
          </div>
        )}
        {media.map((item: any) => (
          <motion.div 
            layout
            key={item.id} 
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden group"
          >
            <div 
              className="aspect-video bg-slate-100 dark:bg-slate-800 relative overflow-hidden cursor-pointer"
              onClick={() => setPreviewMedia(item)}
            >
              {item.thumbnail_path ? (
                <img 
                  src={`/thumbnails/${item.thumbnail_path}`} 
                  alt={item.filename} 
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-700">
                  <Film size={48} />
                </div>
              )}
              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white">
                  <Play size={24} fill="currentColor" />
                </div>
              </div>
              <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/60 text-white text-[10px] font-bold rounded backdrop-blur-sm">
                {Math.floor(item.duration / 60)}:{(item.duration % 60).toString().padStart(2, '0')}
              </div>
            </div>
            <div className="p-4">
              <p className="font-bold text-slate-800 dark:text-slate-200 truncate text-sm mb-1">{item.filename}</p>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400 dark:text-slate-500">{new Date(item.created_at).toLocaleDateString()}</p>
                <button 
                  onClick={() => deleteMedia(item.id)}
                  className="p-2 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
        {media.length === 0 && !uploading && (
          <div className="col-span-full py-20 text-center text-slate-400 dark:text-slate-600 bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
            <Film size={48} className="mx-auto mb-4 opacity-20" />
            <p className="font-medium">Your media library is empty</p>
            <p className="text-sm">Upload your first video to get started</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {previewMedia && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-10">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPreviewMedia(null)}
              className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-4xl aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl"
            >
              <video 
                src={`/api/media/${previewMedia.id}/stream`} 
                controls 
                autoPlay 
                className="w-full h-full"
              />
              <button 
                onClick={() => setPreviewMedia(null)}
                className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-colors"
              >
                <X size={24} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Playlists = () => {
  const [playlists, setPlaylists] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedPlaylist, setSelectedPlaylist] = useState<any>(null);
  const [media, setMedia] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchPlaylists = async () => {
    const data = await fetchJson("/api/playlists");
    setPlaylists(data);
  };

  useEffect(() => {
    fetchPlaylists();
    fetchJson("/api/media").then(setMedia);
  }, []);

  const createPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, loop: true })
    });
    setNewName("");
    setIsCreating(false);
    fetchPlaylists();
  };

  const deletePlaylist = async (id: number) => {
    if (!confirm("Delete this playlist?")) return;
    await fetch(`/api/playlists/${id}`, { method: "DELETE" });
    if (selectedPlaylist?.id === id) setSelectedPlaylist(null);
    fetchPlaylists();
  };

  const viewPlaylist = async (id: number) => {
    const data = await fetchJson(`/api/playlists/${id}`, null);
    setSelectedPlaylist(data);
  };

  const addItem = async (mediaId: number) => {
    if (!selectedPlaylist) return;
    await fetch(`/api/playlists/${selectedPlaylist.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_id: mediaId, order_index: selectedPlaylist.items.length })
    });
    viewPlaylist(selectedPlaylist.id);
  };

  const removeItem = async (itemId: number) => {
    await fetch(`/api/playlists/${selectedPlaylist.id}/items/${itemId}`, { method: "DELETE" });
    viewPlaylist(selectedPlaylist.id);
  };

  const filteredMedia = media.filter((m: any) => 
    m.filename?.toLowerCase().includes(searchTerm.toLowerCase()) &&
    !selectedPlaylist?.items.some((item: any) => item.media_id === m.id)
  );

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Playlists</h1>
          <p className="text-slate-500 dark:text-slate-400">Organize your media sequences</p>
        </div>
        <button 
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all"
        >
          <Plus size={20} />
          New Playlist
        </button>
      </header>

      {isCreating && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-indigo-200 dark:border-indigo-900/30 shadow-sm"
        >
          <form onSubmit={createPlaylist} className="flex gap-4">
            <input 
              type="text" 
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Playlist Name"
              className="flex-1 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
              required
            />
            <button type="submit" className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold">Create</button>
            <button type="button" onClick={() => setIsCreating(false)} className="px-6 py-2 text-slate-500 dark:text-slate-400 font-bold">Cancel</button>
          </form>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-4">
          {playlists.map((p: any) => (
            <div 
              key={p.id} 
              onClick={() => viewPlaylist(p.id)}
              className={cn(
                "p-4 bg-white dark:bg-slate-900 rounded-2xl border transition-all cursor-pointer group",
                selectedPlaylist?.id === p.id ? "border-indigo-600 shadow-md" : "border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-2 rounded-lg",
                    selectedPlaylist?.id === p.id ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/20 group-hover:text-indigo-600 dark:group-hover:text-indigo-400"
                  )}>
                    <ListMusic size={20} />
                  </div>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{p.name}</span>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); deletePlaylist(p.id); }}
                  className="p-2 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          {playlists.length === 0 && (
            <div className="p-10 text-center text-slate-400 dark:text-slate-600 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
              <p className="text-sm">No playlists created yet</p>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          {selectedPlaylist ? (
            <div className="space-y-6">
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
                  <div>
                    <h3 className="font-bold text-slate-800 dark:text-white">{selectedPlaylist.name}</h3>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{selectedPlaylist.items.length} items in playlist</p>
                  </div>
                </div>
                <div className="divide-y divide-slate-50 dark:divide-slate-800">
                  {selectedPlaylist.items.map((item: any, idx: number) => (
                    <div key={item.id} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <div className="flex items-center gap-4">
                        <span className="text-xs font-bold text-slate-300 dark:text-slate-700 w-4">{idx + 1}</span>
                        <div className="w-16 aspect-video bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden">
                          {item.thumbnail_path && (
                            <img src={`/thumbnails/${item.thumbnail_path}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{item.filename}</p>
                          <p className="text-xs text-slate-400 dark:text-slate-500">{Math.floor(item.duration / 60)}:{(item.duration % 60).toString().padStart(2, '0')}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => removeItem(item.id)}
                        className="p-2 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {selectedPlaylist.items.length === 0 && (
                    <div className="p-10 text-center text-slate-400 dark:text-slate-600">
                      <p className="text-sm">Playlist is empty. Add media from below.</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-slate-800 dark:text-white">Add Media to Playlist</h3>
                  <div className="relative">
                    <input 
                      type="text" 
                      placeholder="Search media..." 
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="pl-4 pr-10 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto pr-2">
                  {filteredMedia.map((m: any) => (
                    <div 
                      key={m.id} 
                      onClick={() => addItem(m.id)}
                      className="p-3 border border-slate-100 dark:border-slate-800 rounded-xl flex items-center gap-3 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 cursor-pointer transition-all group"
                    >
                      <div className="w-12 aspect-video bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden shrink-0">
                        {m.thumbnail_path && <img src={`/thumbnails/${m.thumbnail_path}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{m.filename}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">{Math.floor(m.duration / 60)}:{(m.duration % 60).toString().padStart(2, '0')}</p>
                      </div>
                      <div className="p-1 text-slate-300 dark:text-slate-700 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                        <Plus size={16} />
                      </div>
                    </div>
                  ))}
                  {filteredMedia.length === 0 && (
                    <div className="col-span-full py-10 text-center text-slate-400 dark:text-slate-600">
                      <p className="text-sm">No more media available to add</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-600 bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 p-20">
              <ListMusic size={64} className="mb-4 opacity-20" />
              <p className="font-medium">Select a playlist to view its contents</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Streams = () => {
  const [streams, setStreams] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [media, setMedia] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingStream, setEditingStream] = useState<any>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    source_type: "playlist",
    playlist_id: "",
    video_id: "",
    platform: "youtube",
    rtmp_url: "rtmps://a.rtmp.youtube.com/live2",
    stream_key: "",
    bitrate: 3000,
    resolution: "1280x720",
    loop: true,
    duration: -1,
    start_time: "12:00",
    start_date: new Date().toISOString().slice(0, 10),
    repeat_type: "none",
    repeat_days: "",
    repeat_date: 1,
    schedule_enabled: false
  });

  const fetchStreams = async () => {
    const data = await fetchJson("/api/streams");
    setStreams(data);
  };

  useEffect(() => {
    fetchStreams();
    fetchJson("/api/playlists").then(setPlaylists);
    fetchJson("/api/media").then(setMedia);
    
    const interval = setInterval(fetchStreams, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingStream ? `/api/streams/${editingStream.id}` : "/api/streams";
    const method = editingStream ? "PUT" : "POST";
    
    // Ensure empty IDs are sent as null
    const submitData = {
      ...formData,
      playlist_id: formData.playlist_id || null,
      video_id: formData.video_id || null,
      schedule_enabled: formData.schedule_enabled ? 1 : 0
    };
    
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitData)
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        alert(errorData.error || "Failed to save stream");
        return;
      }
      
      setIsCreating(false);
      setEditingStream(null);
      fetchStreams();
    } catch (err) {
      console.error("Submit error:", err);
      alert("An error occurred while saving the stream");
    }
  };

  const toggleStream = async (id: number, status: string) => {
    const action = status === 'live' ? 'stop' : 'start';
    await fetch(`/api/streams/${id}/${action}`, { method: "POST" });
    fetchStreams();
  };

  const deleteStream = async (id: number) => {
    if (!confirm("Delete this stream configuration?")) return;
    await fetch(`/api/streams/${id}`, { method: "DELETE" });
    fetchStreams();
  };

  const handleEdit = (stream: any) => {
    setEditingStream(stream);
    setFormData({
      name: stream.name,
      source_type: stream.source_type || "playlist",
      playlist_id: stream.playlist_id || "",
      video_id: stream.video_id || "",
      platform: stream.platform || "youtube",
      rtmp_url: stream.rtmp_url,
      stream_key: stream.stream_key,
      bitrate: stream.bitrate,
      resolution: stream.resolution,
      loop: stream.loop === 1,
      duration: stream.duration || -1,
      start_time: stream.start_time || "12:00",
      start_date: stream.start_date || new Date().toISOString().slice(0, 10),
      repeat_type: stream.repeat_type || "none",
      repeat_days: stream.repeat_days || "",
      repeat_date: stream.repeat_date || 1,
      schedule_enabled: stream.schedule_enabled === 1
    });
    setIsCreating(true);
  };

  const platforms = [
    { id: 'youtube', name: 'YouTube', url: 'rtmps://a.rtmp.youtube.com/live2' },
    { id: 'facebook', name: 'Facebook Live', url: 'rtmps://live-api-s.facebook.com:443/rtmp' },
    { id: 'tiktok', name: 'TikTok', url: 'rtmps://ingest.global.live.prod.tiktok.com/live' },
    { id: 'shopee', name: 'Shopee Live', url: 'rtmps://live.shopee.co.id/live' },
    { id: 'twitch', name: 'Twitch', url: 'rtmps://live.twitch.tv/live' },
    { id: 'custom', name: 'Custom RTMP', url: '' }
  ];

  const bitrates = [
    { label: 'Resolusi 4K, fps 30, bitrate 12000', value: 12000 },
    { label: 'Resolusi 1080p, fps 30, bitrate 6500', value: 6500 },
    { label: 'Resolusi 720p, fps 30, bitrate 2500', value: 2500 },
    { label: 'Custom 3000k', value: 3000 },
    { label: 'Custom 1500k', value: 1500 }
  ];

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Streams</h1>
          <p className="text-slate-500 dark:text-slate-400">Configure and monitor your broadcasts</p>
        </div>
        <button 
          onClick={() => { setIsCreating(true); setEditingStream(null); setFormData({
            name: "", source_type: "playlist", playlist_id: "", video_id: "", platform: "youtube",
            rtmp_url: "rtmps://a.rtmp.youtube.com/live2", stream_key: "", bitrate: 3000, resolution: "1280x720",
            loop: true, duration: -1, start_time: "12:00", start_date: new Date().toISOString().slice(0, 10),
            repeat_type: "none", repeat_days: "", repeat_date: 1, schedule_enabled: true
          }); }}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all"
        >
          <Plus size={20} />
          New Stream
        </button>
      </header>

      {isCreating && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl"
        >
          <h2 className="text-xl font-bold mb-6 text-slate-800 dark:text-white">{editingStream ? 'Edit Stream' : 'Create New Stream'}</h2>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Stream Name</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="My Awesome Stream"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Platform</label>
                <select 
                  value={formData.platform}
                  onChange={e => {
                    const p = platforms.find(pl => pl.id === e.target.value);
                    setFormData({...formData, platform: e.target.value, rtmp_url: p?.url || formData.rtmp_url});
                  }}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Source Type</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={formData.source_type === 'playlist'} onChange={() => setFormData({...formData, source_type: 'playlist'})} className="accent-indigo-600" />
                    <span className="text-sm text-slate-600 dark:text-slate-400">Playlist</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={formData.source_type === 'video'} onChange={() => setFormData({...formData, source_type: 'video'})} className="accent-indigo-600" />
                    <span className="text-sm text-slate-600 dark:text-slate-400">Single Video</span>
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                {formData.source_type === 'playlist' ? (
                  <>
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Playlist Source</label>
                    <select 
                      value={formData.playlist_id}
                      onChange={e => setFormData({...formData, playlist_id: e.target.value})}
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                      required
                    >
                      <option value="">Select Playlist</option>
                      {playlists.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Video Source</label>
                    <select 
                      value={formData.video_id}
                      onChange={e => setFormData({...formData, video_id: e.target.value})}
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                      required
                    >
                      <option value="">Select Video</option>
                      {media.map((m: any) => <option key={m.id} value={m.id}>{m.filename}</option>)}
                    </select>
                  </>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">RTMP URL</label>
                <input 
                  type="text" 
                  value={formData.rtmp_url}
                  onChange={e => setFormData({...formData, rtmp_url: e.target.value})}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="rtmp://..."
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Stream Key</label>
                <input 
                  type="password" 
                  value={formData.stream_key}
                  onChange={e => setFormData({...formData, stream_key: e.target.value})}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="xxxx-xxxx-xxxx-xxxx"
                  required
                />
              </div>
            </div>

              <div className="pt-6 border-t border-slate-100 dark:border-slate-800 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Duration (Hours)</label>
                    <select 
                      value={formData.duration}
                      onChange={e => setFormData({...formData, duration: parseInt(e.target.value)})}
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="-1">Infinite (Manual Stop)</option>
                      {[...Array(24)].map((_, i) => (
                        <option key={i+1} value={i+1}>{i+1} Hour{i > 0 ? 's' : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2 flex items-end pb-2">
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className="relative">
                        <input 
                          type="checkbox" 
                          checked={formData.loop}
                          onChange={e => setFormData({...formData, loop: e.target.checked})}
                          className="sr-only peer"
                        />
                        <div className="w-10 h-6 bg-slate-200 dark:bg-slate-800 rounded-full peer peer-checked:bg-indigo-600 transition-all after:content-[''] after:absolute after:top-1 after:left-1 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
                      </div>
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-300 group-hover:text-indigo-600 transition-colors">Loop Content</span>
                    </label>
                  </div>
                </div>

                <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center justify-between">
                  Scheduling
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div className="relative">
                      <input 
                        type="checkbox" 
                        checked={formData.schedule_enabled}
                        onChange={e => setFormData({...formData, schedule_enabled: e.target.checked})}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-slate-200 dark:bg-slate-800 rounded-full peer peer-checked:bg-indigo-600 transition-all after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-4"></div>
                    </div>
                    <span className="text-xs font-bold text-slate-500">Enable Schedule</span>
                  </label>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Start Date</label>
                    <input 
                      type="date" 
                      value={formData.start_date}
                      onChange={e => setFormData({...formData, start_date: e.target.value})}
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Start Time</label>
                    <input 
                      type="time" 
                      value={formData.start_time}
                      onChange={e => setFormData({...formData, start_time: e.target.value})}
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Repetition</label>
                    <select 
                      value={formData.repeat_type}
                      onChange={e => setFormData({...formData, repeat_type: e.target.value})}
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="none">Once (One Time)</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>

              {formData.repeat_type === 'weekly' && (
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Repeat Days</label>
                  <div className="flex flex-wrap gap-2">
                    {['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          const days = formData.repeat_days.split(",").filter(Boolean);
                          const newDays = days?.includes(day) ? days.filter(d => d !== day) : [...(days || []), day];
                          setFormData({...formData, repeat_days: newDays.join(",")});
                        }}
                        className={cn(
                          "px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                          formData.repeat_days?.includes(day)
                            ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200"
                        )}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {formData.repeat_type === 'monthly' && (
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Day of Month</label>
                  <input 
                    type="number" 
                    min="1" 
                    max="31"
                    value={formData.repeat_date}
                    onChange={e => setFormData({...formData, repeat_date: parseInt(e.target.value)})}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              <button 
                type="button" 
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-sm font-bold text-indigo-600 flex items-center gap-2 mb-4"
              >
                {showAdvanced ? 'Hide' : 'Show'} Advanced Settings (Bitrate & Resolution)
              </button>

              {showAdvanced && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Bitrate Preset</label>
                    <select 
                      value={formData.bitrate}
                      onChange={e => setFormData({...formData, bitrate: Number(e.target.value)})}
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {bitrates.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Resolution</label>
                    <select 
                      value={formData.resolution}
                      onChange={e => setFormData({...formData, resolution: e.target.value})}
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="3840x2160">4K (3840x2160)</option>
                      <option value="1920x1080">1080p (1920x1080)</option>
                      <option value="1280x720">720p (1280x720)</option>
                      <option value="854x480">480p (854x480)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-4 pt-4">
              <button 
                type="button" 
                onClick={() => { setIsCreating(false); setEditingStream(null); }} 
                className="px-6 py-2 text-slate-500 dark:text-slate-400 font-bold hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="px-8 py-2 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all active:scale-95"
              >
                {editingStream ? 'Update Stream' : 'Create Stream'}
              </button>
            </div>
          </form>
        </motion.div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {streams.map((stream: any) => (
          <div key={stream.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col md:flex-row group transition-all hover:shadow-md">
            {/* Thumbnail Section */}
            <div className="w-full md:w-64 h-48 md:h-auto relative bg-slate-100 dark:bg-slate-800 flex-shrink-0">
              <div className="absolute inset-0 flex items-center justify-center">
                <Radio size={48} className={cn("text-slate-300 dark:text-slate-700", stream.status === 'live' && "animate-pulse text-emerald-500/20")} />
              </div>
              {/* Placeholder for real thumbnail if available */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex flex-col justify-end p-4">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    stream.status === 'live' ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                  )} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-white">
                    {stream.status === 'live' ? 'Live Now' : 'Offline'}
                  </span>
                </div>
              </div>
              <div className="absolute top-4 right-4 px-2 py-1 bg-black/50 backdrop-blur-md rounded-lg border border-white/10">
                <span className="text-[10px] font-bold text-white uppercase">{stream.platform}</span>
              </div>
            </div>

            {/* Content Section */}
            <div className="flex-1 p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white group-hover:text-indigo-600 transition-colors">{stream.name}</h3>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleEdit(stream)}
                      className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-xl transition-all"
                    >
                      <Settings size={18} />
                    </button>
                    <button 
                      onClick={() => deleteStream(stream.id)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-y-3 gap-x-6 text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                      <ListMusic size={14} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase font-bold text-slate-400">Source</p>
                      <p className="font-bold text-slate-700 dark:text-slate-300 truncate">
                        {stream.source_type === 'video' ? stream.video_name : (stream.playlist_name || 'No Playlist')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                      <Clock size={14} />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400">Duration</p>
                      <p className="font-bold text-slate-700 dark:text-slate-300">
                        {stream.duration === -1 ? 'Infinite' : `${stream.duration}h`} {stream.loop === 1 && '(Loop)'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                      <Calendar size={14} />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400">Schedule</p>
                      <p className="font-bold text-slate-700 dark:text-slate-300">
                        {!stream.schedule_enabled ? 'Manual Only' : (
                          <>
                            {stream.start_time} 
                            <span className="ml-1 text-indigo-500">
                              ({stream.repeat_type === 'none' ? 'Once' : stream.repeat_type})
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between pt-6 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-full">
                    <Radio size={12} className="text-slate-400" />
                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">{stream.bitrate}kbps</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-full">
                    <Settings size={12} className="text-slate-400" />
                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">{stream.resolution}</span>
                  </div>
                </div>

                <button 
                  onClick={() => toggleStream(stream.id, stream.status)}
                  className={cn(
                    "flex items-center gap-2 px-8 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all active:scale-95",
                    stream.status === 'live' 
                      ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100" 
                      : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-none"
                  )}
                >
                  {stream.status === 'live' ? <><Square size={16} /> Stop Stream</> : <><Play size={16} /> Start Stream</>}
                </button>
              </div>
            </div>
          </div>
        ))}
        {streams.length === 0 && !isCreating && (
          <div className="py-20 text-center text-slate-400 dark:text-slate-600 bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
            <Radio size={48} className="mx-auto mb-4 opacity-20" />
            <p className="font-bold">No stream configurations found</p>
            <p className="text-sm mt-1">Click "New Stream" to get started</p>
          </div>
        )}
      </div>
    </div>
  );
};

const Scheduler = () => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [streams, setStreams] = useState([]);

  const fetchStreams = async () => {
    const data = await fetchJson("/api/streams");
    setStreams(data);
  };

  useEffect(() => {
    fetchStreams();
    const interval = setInterval(fetchStreams, 10000);
    return () => clearInterval(interval);
  }, []);

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const startDay = getDay(daysInMonth[0]);
  const calendarBlanks = Array(startDay).fill(null);
  
  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const getStreamsForDay = (day: Date) => {
    const dayStr = format(day, 'yyyy-MM-dd');
    const dayName = format(day, 'eee').toLowerCase();
    const dayOfMonth = getDate(day);

    return streams.filter((s: any) => {
      if (!s.schedule_enabled) return false;
      
      const streamStartDate = s.start_date || "";
      
      if (s.repeat_type === 'none') {
        return streamStartDate === dayStr;
      } else if (s.repeat_type === 'daily') {
        return isAfter(day, subDays(new Date(streamStartDate), 1));
      } else if (s.repeat_type === 'weekly') {
        const days = (s.repeat_days || "").split(",");
        return days?.includes(dayName) && isAfter(day, subDays(new Date(streamStartDate), 1));
      } else if (s.repeat_type === 'monthly') {
        return s.repeat_date === dayOfMonth && isAfter(day, subDays(new Date(streamStartDate), 1));
      }
      return false;
    });
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Broadcast Calendar</h1>
          <p className="text-slate-500 dark:text-slate-400">View your scheduled live streams</p>
        </div>
        <div className="flex items-center gap-4 bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <button onClick={prevMonth} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors dark:text-white"><ChevronLeft size={20} /></button>
          <span className="font-bold text-slate-700 dark:text-slate-300 min-w-[140px] text-center">{format(currentMonth, 'MMMM yyyy')}</span>
          <button onClick={nextMonth} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors dark:text-white"><ChevronRight size={20} /></button>
        </div>
      </header>

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        <div className="grid grid-cols-7 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="p-4 text-center text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {calendarBlanks.map((_, i) => <div key={`blank-${i}`} className="h-32 border-b border-r border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-950/30" />)}
          {daysInMonth.map(day => {
            const dayStreams = getStreamsForDay(day);
            const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
            const isPast = isBefore(day, startOfDay(new Date()));

            return (
              <div key={day.toString()} className={cn(
                "h-32 border-b border-r border-slate-100 dark:border-slate-800 p-2 overflow-y-auto transition-colors",
                isToday ? "bg-indigo-50/30 dark:bg-indigo-900/10" : "hover:bg-slate-50/50 dark:hover:bg-slate-800/50"
              )}>
                <div className="flex justify-between items-start mb-1">
                  <span className={cn(
                    "text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full",
                    isToday ? "bg-indigo-600 text-white" : "text-slate-400 dark:text-slate-600"
                  )}>
                    {getDate(day)}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayStreams.map((s: any) => (
                    <div key={s.id} className={cn(
                      "text-[10px] p-1.5 rounded-lg border flex flex-col gap-0.5",
                      s.status === 'live' && isToday 
                        ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400" 
                        : isPast 
                          ? "bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-600" 
                          : "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-800 text-indigo-700 dark:text-indigo-400"
                    )}>
                      <div className="font-bold truncate">{s.name}</div>
                      <div className="flex items-center gap-1 opacity-70">
                        <Clock size={8} /> {s.start_time}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const Guide = () => {
  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Streaming Guide</h1>
        <p className="text-slate-500 dark:text-slate-400">Everything you need to know to start streaming like a pro</p>
      </header>

      <div className="grid grid-cols-1 gap-8">
        <section className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
            <Radio size={24} /> 1. Setting Up Your Stream
          </h2>
          <div className="space-y-4 text-slate-600 dark:text-slate-400 leading-relaxed">
            <p>To start streaming, you first need to configure a <strong>Stream</strong>. Go to the "Streams" tab and click "New Stream".</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Stream Name:</strong> A friendly name for your own reference.</li>
              <li><strong>Platform:</strong> Select where you want to stream. We provide default RTMP URLs for major platforms.</li>
              <li><strong>Stream Key:</strong> This is a secret key provided by your streaming platform (YouTube, Facebook, etc.). <strong>Never share this key!</strong></li>
              <li><strong>Source:</strong> You can choose to stream an entire <strong>Playlist</strong> or a <strong>Single Video</strong>.</li>
            </ul>
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <Film size={24} /> 2. Managing Your Media
          </h2>
          <div className="space-y-4 text-slate-600 dark:text-slate-400 leading-relaxed">
            <p>Before you can stream, you need content. Use the <strong>Media Library</strong> to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Upload:</strong> Upload MP4 files directly from your computer.</li>
              <li><strong>Download:</strong> Provide a direct link (Google Drive, Dropbox, etc.) and our server will fetch it for you.</li>
              <li><strong>Playlists:</strong> Group your videos into playlists for continuous 24/7 streaming.</li>
            </ul>
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <Calendar size={24} /> 3. Scheduling & Calendar
          </h2>
          <div className="space-y-4 text-slate-600 dark:text-slate-400 leading-relaxed">
            <p>Want to start a stream at a specific time? You can now configure <strong>Scheduling</strong> directly within each stream's settings.</p>
            <p>Set up one-time events or recurring schedules (Daily, Weekly, Monthly). The system will automatically start the stream for you at the designated time. You can view all your scheduled broadcasts in the <strong>Calendar</strong> tab.</p>
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-red-600 dark:text-red-400">
            <Activity size={24} /> 4. Troubleshooting
          </h2>
          <div className="space-y-4 text-slate-600 dark:text-slate-400 leading-relaxed">
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Stream won't start:</strong> Double-check your Stream Key and RTMP URL. Ensure the video file exists in the library.</li>
              <li><strong>Buffering:</strong> Check your server's CPU usage in the Dashboard. High bitrates (like 4K) require more processing power.</li>
              <li><strong>Storage Full:</strong> Delete old media files to free up space. Each user has a storage limit set by the administrator.</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
};

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    role: "member",
    status: "active",
    storage_limit: 10
  });

  const fetchUsers = async () => {
    const data = await fetchJson("/api/users");
    setUsers(data);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingUser ? `/api/users/${editingUser.id}` : "/api/users";
    const method = editingUser ? "PUT" : "POST";
    
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData)
    });
    
    if (res.ok) {
      setIsCreating(false);
      setEditingUser(null);
      setFormData({ username: "", password: "", role: "member", status: "active", storage_limit: 10 });
      fetchUsers();
    } else {
      const data = await res.json();
      alert(data.error || "An error occurred");
    }
  };

  const deleteUser = async (id: number) => {
    if (!confirm("Are you sure you want to delete this user?")) return;
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (res.ok) fetchUsers();
    else {
      const data = await res.json();
      alert(data.error);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-white">User Management</h1>
          <p className="text-slate-500 dark:text-slate-400">Manage system users and storage limits</p>
        </div>
        <button 
          onClick={() => { setIsCreating(true); setEditingUser(null); setFormData({ username: "", password: "", role: "member", status: "active", storage_limit: 10 }); }}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all"
        >
          <UserPlus size={20} />
          Add User
        </button>
      </header>

      {(isCreating || editingUser) && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold dark:text-white">{editingUser ? 'Edit User' : 'Create New User'}</h2>
            <button onClick={() => { setIsCreating(false); setEditingUser(null); }} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
              <X size={20} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Username</label>
              <input 
                type="text" 
                value={formData.username}
                onChange={e => setFormData({...formData, username: e.target.value})}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Password {editingUser && '(Leave blank to keep current)'}</label>
              <input 
                type="password" 
                value={formData.password}
                onChange={e => setFormData({...formData, password: e.target.value})}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                required={!editingUser}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Role</label>
              <select 
                value={formData.role}
                onChange={e => setFormData({...formData, role: e.target.value})}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Status</label>
              <select 
                value={formData.status}
                onChange={e => setFormData({...formData, status: e.target.value})}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Storage Limit (GB)</label>
              <input 
                type="number" 
                value={formData.storage_limit}
                onChange={e => setFormData({...formData, storage_limit: Number(e.target.value)})}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <div className="md:col-span-2 flex justify-end gap-3 pt-4">
              <button 
                type="button"
                onClick={() => { setIsCreating(false); setEditingUser(null); }}
                className="px-6 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all"
              >
                {editingUser ? 'Update User' : 'Create User'}
              </button>
            </div>
          </form>
        </motion.div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50 border-bottom border-slate-200 dark:border-slate-800">
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">User</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Role</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Storage</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {users.map((u: any) => (
              <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400 font-bold text-xs overflow-hidden">
                      {u.profile_picture ? (
                        <img src={u.profile_picture} alt={u.username} className="w-full h-full object-cover" />
                      ) : (
                        u.username[0].toUpperCase()
                      )}
                    </div>
                    <span className="font-bold text-slate-800 dark:text-white">{u.username}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-1 rounded-full uppercase",
                    u.role === 'admin' ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400" : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                  )}>
                    {u.role}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "flex items-center gap-1.5 text-sm font-bold",
                    u.status === 'active' ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500"
                  )}>
                    {u.status === 'active' ? <CheckCircle2 size={14} /> : <X size={14} />}
                    {u.status}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden max-w-[60px]">
                      <div className="h-full bg-indigo-500" style={{ width: '20%' }} />
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{u.storage_limit} GB</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button 
                      onClick={() => {
                        setEditingUser(u);
                        setFormData({ 
                          username: u.username, 
                          password: "", 
                          role: u.role, 
                          status: u.status, 
                          storage_limit: u.storage_limit 
                        });
                      }}
                      className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
                    >
                      <Settings size={18} />
                    </button>
                    <button 
                      onClick={() => deleteUser(u.id)}
                      className="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SettingsPage = () => {
  const { user, refreshUser } = useContext(AuthContext)!;
  const [username, setUsername] = useState(user?.username || "");
  const [password, setPassword] = useState("");
  const [updating, setUpdating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    const fetchSettings = async () => {
      const res = await fetch("/api/system/settings");
      if (res.ok) {
        const data = await res.json();
        if (data.timezone) setTimezone(data.timezone);
      }
    };
    fetchSettings();
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        alert("Profile updated successfully");
        setPassword("");
        refreshUser();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(false);
    }
  };

  const saveSystemSettings = async () => {
    setUpdating(true);
    try {
      const res = await fetch("/api/system/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone })
      });
      if (res.ok) {
        alert("System settings saved");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(false);
    }
  };

  const handleProfileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("profile", file);

    try {
      const res = await fetch("/api/me/profile", {
        method: "POST",
        body: formData
      });
      if (res.ok) {
        refreshUser();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Settings</h1>
        <p className="text-slate-500 dark:text-slate-400">Manage your account and preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <h2 className="text-xl font-bold mb-6 dark:text-white">Account Information</h2>
            <form onSubmit={handleUpdate} className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Username</label>
                <input 
                  type="text" 
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">New Password (leave blank to keep current)</label>
                <input 
                  type="password" 
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  placeholder="••••••••"
                />
              </div>
              <button 
                type="submit"
                disabled={updating}
                className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all disabled:opacity-50"
              >
                {updating ? "Saving..." : "Save Changes"}
              </button>
            </form>
          </section>

          {user?.role === 'admin' && (
            <section className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <h2 className="text-xl font-bold mb-6 dark:text-white">System Preferences</h2>
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Timezone (UTC/GMT)</label>
                  <select 
                    value={timezone}
                    onChange={e => setTimezone(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  >
                    <option value="UTC">UTC (GMT+0)</option>
                    <option value="Asia/Jakarta">Asia/Jakarta (GMT+7)</option>
                    <option value="Asia/Singapore">Asia/Singapore (GMT+8)</option>
                    <option value="Asia/Tokyo">Asia/Tokyo (GMT+9)</option>
                    <option value="Europe/London">Europe/London (GMT+0/1)</option>
                    <option value="Europe/Paris">Europe/Paris (GMT+1/2)</option>
                    <option value="America/New_York">America/New_York (GMT-5/4)</option>
                    <option value="America/Los_Angeles">America/Los_Angeles (GMT-8/7)</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-1 italic">Pilih zona waktu sesuai lokasi Anda untuk penjadwalan yang akurat.</p>
                </div>

                <button 
                  onClick={saveSystemSettings}
                  disabled={updating}
                  className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all disabled:opacity-50"
                >
                  {updating ? "Saving..." : "Save Preferences"}
                </button>
              </div>
            </section>
          )}
        </div>

        <div className="space-y-8">
          <section className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm text-center">
            <h2 className="text-xl font-bold mb-6 dark:text-white">Profile Picture</h2>
            <div className="relative inline-block mb-6">
              <div className="w-32 h-32 rounded-full bg-slate-100 dark:bg-slate-800 border-4 border-white dark:border-slate-700 shadow-lg overflow-hidden flex items-center justify-center text-slate-400">
                {user?.profile_picture ? (
                  <img src={user.profile_picture} alt={user.username} className="w-full h-full object-cover" />
                ) : (
                  <Users size={48} />
                )}
              </div>
              <label className="absolute bottom-0 right-0 p-2 bg-indigo-600 text-white rounded-full shadow-lg cursor-pointer hover:bg-indigo-700 transition-all">
                <Plus size={20} />
                <input type="file" className="hidden" onChange={handleProfileUpload} accept="image/*" disabled={uploading} />
              </label>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {uploading ? "Uploading..." : "Click the plus icon to upload a new photo"}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

// --- App Router ---

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <Router>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<Layout><Dashboard /></Layout>} />
              <Route path="/media" element={<Layout><MediaLibrary /></Layout>} />
              <Route path="/playlists" element={<Layout><Playlists /></Layout>} />
              <Route path="/streams" element={<Layout><Streams /></Layout>} />
              <Route path="/scheduler" element={<Layout><Scheduler /></Layout>} />
              <Route path="/guide" element={<Layout><Guide /></Layout>} />
              <Route path="/users" element={<Layout><UserManagement /></Layout>} />
              <Route path="/settings" element={<Layout><SettingsPage /></Layout>} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Router>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
