import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  getDoc, 
  setDoc,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { db } from './firebase';
import { 
  format, 
  addDays, 
  differenceInDays, 
  isPast, 
  isToday, 
  parseISO,
  startOfDay,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths
} from 'date-fns';
import { 
  Calendar, 
  Clock, 
  Plus, 
  Trash2, 
  Pencil,
  CheckCircle2, 
  AlertCircle, 
  Smartphone, 
  Monitor, 
  RefreshCw, 
  ChevronRight,
  ChevronLeft,
  Info,
  Copy,
  Check,
  Download,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface Deadline {
  id: string;
  groupId: string;
  caseName: string;
  type: string;
  dueDate: string;
  status: 'pending' | 'completed' | 'overdue';
  notes?: string;
  reminderDays: number;
  createdAt: any;
}

const TEMPLATES = [
  { name: '专利无效答辩期', value: 1, unit: 'months', desc: '收到无效宣告请求通知书之日起1个月内' },
  { name: '专利无效起诉期', value: 3, unit: 'months', desc: '收到无效宣告请求审查决定之日起3个月内' },
  { name: '行政上诉期', value: 15, unit: 'days', desc: '收到判决书次日起15日' },
  { name: '民事一审上诉期', value: 15, unit: 'days', desc: '收到判决书次日起15日' },
  { name: '民事二审上诉期', value: 15, unit: 'days', desc: '收到判决书次日起15日' },
  { name: '举证期限', value: 15, unit: 'days', desc: '通常为15日或法院指定' },
  { name: '开庭', value: 0, unit: 'days', desc: '法院开庭日期' },
  { name: '口审', value: 0, unit: 'days', desc: '专利局口头审理日期' },
];

export default function App() {
  const [groupId, setGroupId] = useState<string | null>(localStorage.getItem('lawyer_group_id'));
  const [syncCode, setSyncCode] = useState<string | null>(null);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState<Deadline | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isDayDetailsOpen, setIsDayDetailsOpen] = useState(false);
  const [newDeadline, setNewDeadline] = useState({
    caseName: '',
    type: TEMPLATES[0].name,
    startDate: format(new Date(), 'yyyy-MM-dd'),
    value: TEMPLATES[0].value,
    unit: TEMPLATES[0].unit,
    reminderDays: 3,
    notes: '',
  });

  const calculateDueDate = (startDate: string, value: number, unit: string) => {
    const start = parseISO(startDate);
    let end = unit === 'months' ? addMonths(start, value) : addDays(start, value);
    return end;
  };

  const isWeekend = (date: Date) => {
    const day = date.getDay();
    return day === 0 || day === 6;
  };
  const [inputSyncCode, setInputSyncCode] = useState('');
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');

  const getDeadlineColor = (deadline: Deadline) => {
    if (deadline.status === 'completed') return 'bg-gray-50 border-gray-100 text-gray-400';
    
    const daysLeft = differenceInDays(parseISO(deadline.dueDate), startOfDay(new Date()));
    
    if (deadline.type === '开庭' || deadline.type === '口审') {
      return 'bg-red-50 border-red-200 text-red-700';
    }
    
    if (daysLeft <= 3) {
      return 'bg-orange-50 border-orange-200 text-orange-700';
    }
    
    if (daysLeft <= 7) {
      return 'bg-yellow-50 border-yellow-200 text-yellow-700';
    }
    
    return 'bg-blue-50 border-blue-200 text-blue-700';
  };

  const filteredDeadlines = useMemo(() => {
    return deadlines.filter(d => {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = d.caseName.toLowerCase().includes(searchLower) || 
                           (d.notes || '').toLowerCase().includes(searchLower) ||
                           d.type.toLowerCase().includes(searchLower);
      const matchesType = filterType === 'all' || d.type === filterType;
      return matchesSearch && matchesType;
    });
  }, [deadlines, searchTerm, filterType]);

  const handleParseAndImport = async () => {
    if (!groupId || !importText.trim() || isImporting) return;
    setIsImporting(true);
    
    try {
      const lines = importText.trim().split('\n');
      // Skip header if it exists
      const startIdx = lines[0].includes('官文名称') || lines[0].includes('官方期限') ? 1 : 0;
      
      let addedCount = 0;
      let skippedCount = 0;

      for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Try comma first, then tab
        let parts = line.split(',');
        if (parts.length < 5) parts = line.split('\t');
        
        if (parts.length < 10) continue;

        // Map based on the provided format:
        // 我方代理(0), 无效案件编号(1), 恒博案号(2), 专利/诉讼号(3), 名称(4), 专利权人(5), 无效宣告请求人(6), 官文名称(7), 通知书发文日(8), 官方期限(9), 处理人(10), 备注(11)
        const patentNo = parts[3]?.trim();
        const name = parts[4]?.trim();
        const caseName = patentNo ? `${name} (${patentNo})` : name;
        const type = parts[7]?.trim();
        let dueDate = parts[9]?.trim().replace(/\//g, '-');
        const handler = parts[10]?.trim();
        const remark = parts[11]?.trim();
        const notes = `处理人: ${handler}${remark ? `; 备注: ${remark}` : ''}`;

        if (!caseName || !type || !dueDate) continue;

        // Basic date validation/formatting (ensure YYYY-MM-DD)
        if (dueDate.split('-').some(p => p.length === 1)) {
          dueDate = dueDate.split('-').map(p => p.padStart(2, '0')).join('-');
        }

        // Duplicate check
        const isDuplicate = deadlines.some(d => 
          d.caseName === caseName && 
          d.type === type && 
          d.dueDate === dueDate
        );

        if (isDuplicate) {
          skippedCount++;
          continue;
        }

        await addDoc(collection(db, 'deadlines'), {
          groupId,
          caseName,
          type,
          dueDate,
          reminderDays: 3,
          status: 'pending',
          notes,
          createdAt: serverTimestamp()
        });
        addedCount++;
      }

      alert(`导入完成！\n成功导入: ${addedCount} 条\n跳过重复: ${skippedCount} 条`);
      setShowImportModal(false);
      setImportText('');
    } catch (error) {
      console.error("Import error:", error);
      alert("导入解析失败，请检查格式是否正确（建议从Excel复制粘贴）");
    } finally {
      setIsImporting(false);
    }
  };

  // Get unique case names for datalist
  const existingCaseNames = useMemo(() => {
    const names = deadlines.map(d => d.caseName);
    return Array.from(new Set(names));
  }, [deadlines]);

  const uniqueTypes = useMemo(() => {
    const types = deadlines.map(d => d.type);
    return Array.from(new Set(types));
  }, [deadlines]);

  // --- Sync Key Logic ---
  useEffect(() => {
    if (!groupId) {
      // Generate a new group ID and sync code if none exists
      const newGroupId = Math.random().toString(36).substring(2, 15);
      const newSyncCode = Math.floor(100000 + Math.random() * 900000).toString();
      
      const setupSync = async () => {
        await setDoc(doc(db, 'syncKeys', newSyncCode), {
          code: newSyncCode,
          groupId: newGroupId,
          createdAt: serverTimestamp()
        });
        localStorage.setItem('lawyer_group_id', newGroupId);
        setGroupId(newGroupId);
        setSyncCode(newSyncCode);
      };
      setupSync();
    } else {
      // Find existing sync code for this group
      const findSyncCode = async () => {
        const q = query(collection(db, 'syncKeys'), where('groupId', '==', groupId));
        // In a real app we'd handle multiple codes, but here we just need one
        onSnapshot(q, (snapshot) => {
          if (!snapshot.empty) {
            setSyncCode(snapshot.docs[0].id);
          }
        });
      };
      findSyncCode();
    }
  }, [groupId]);

  // --- Data Fetching ---
  useEffect(() => {
    if (!groupId) return;

    const q = query(
      collection(db, 'deadlines'), 
      where('groupId', '==', groupId),
      orderBy('dueDate', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Deadline[];
      setDeadlines(data);

      // Check for overdue items
      data.forEach(d => {
        if (d.status === 'pending' && isPast(parseISO(d.dueDate)) && !isToday(parseISO(d.dueDate))) {
          updateDoc(doc(db, 'deadlines', d.id), { status: 'overdue' });
        }
      });
    });

    return () => unsubscribe();
  }, [groupId]);

  // --- Handlers ---
  const handleAddDeadline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupId) return;

    const due = calculateDueDate(newDeadline.startDate, newDeadline.value, newDeadline.unit);
    const dueDate = format(due, 'yyyy-MM-dd');
    
    await addDoc(collection(db, 'deadlines'), {
      groupId,
      caseName: newDeadline.caseName,
      type: newDeadline.type,
      dueDate,
      reminderDays: newDeadline.reminderDays,
      status: 'pending',
      notes: newDeadline.notes,
      createdAt: serverTimestamp()
    });

    setIsAdding(false);
    setNewDeadline({ ...newDeadline, caseName: '', notes: '', reminderDays: 3 });
  };

  const toggleStatus = async (deadline: Deadline) => {
    const newStatus = deadline.status === 'completed' ? 'pending' : 'completed';
    await updateDoc(doc(db, 'deadlines', deadline.id), { status: newStatus });
  };

  const deleteDeadline = async (id: string) => {
    await deleteDoc(doc(db, 'deadlines', id));
  };

  const handleEdit = (deadline: Deadline) => {
    setEditingDeadline(deadline);
    setIsEditing(true);
  };

  const handleUpdateDeadline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDeadline) return;

    await updateDoc(doc(db, 'deadlines', editingDeadline.id), {
      caseName: editingDeadline.caseName,
      type: editingDeadline.type,
      dueDate: editingDeadline.dueDate,
      reminderDays: editingDeadline.reminderDays || 3,
      notes: editingDeadline.notes || '',
    });

    setIsEditing(false);
    setEditingDeadline(null);
  };

  const handlePair = async () => {
    const docRef = doc(db, 'syncKeys', inputSyncCode);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      localStorage.setItem('lawyer_group_id', data.groupId);
      setGroupId(data.groupId);
      setShowSyncModal(false);
      alert('同步成功！');
    } else {
      alert('无效的同步码');
    }
  };

  const copySyncCode = () => {
    if (syncCode) {
      navigator.clipboard.writeText(syncCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // --- Calculations ---
  const stats = useMemo(() => {
    const pending = deadlines.filter(d => d.status === 'pending').length;
    const overdue = deadlines.filter(d => d.status === 'overdue').length;
    const completed = deadlines.filter(d => d.status === 'completed').length;
    return { pending, overdue, completed };
  }, [deadlines]);

  const [currentMonth, setCurrentMonth] = useState(new Date());

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const getDeadlinesForDay = (day: Date) => {
    return deadlines.filter(d => isSameDay(parseISO(d.dueDate), day));
  };

  const handleAddAtDate = (day: Date) => {
    setNewDeadline(prev => ({
      ...prev,
      startDate: format(day, 'yyyy-MM-dd')
    }));
    setIsAdding(true);
    setIsDayDetailsOpen(false);
  };

  const handleDayClick = (day: Date) => {
    setSelectedDate(day);
    setIsDayDetailsOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Calendar className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-xl tracking-tight">律师期限提醒</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="bg-gray-100 p-1 rounded-xl flex items-center gap-1">
              <button 
                onClick={() => setView('list')}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${view === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
              >
                列表
              </button>
              <button 
                onClick={() => setView('calendar')}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${view === 'calendar' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
              >
                日历
              </button>
            </div>
            
            <button 
              onClick={() => setShowImportModal(true)}
              className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-sm font-bold hover:bg-blue-100 transition-all"
            >
              <Download className="w-4 h-4" />
              <span>导入数据</span>
            </button>

            <button 
              onClick={() => setShowSyncModal(true)}
              className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              <Smartphone className="w-4 h-4" />
              <span className="hidden sm:inline">多端同步</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-6 mb-10">
          <div className="bg-white p-5 rounded-[24px] border-[6px] border-gray-100/50 shadow-xl shadow-gray-200/50 flex flex-col">
            <p className="text-sm text-gray-400 font-bold mb-1">进行中</p>
            <p className="text-4xl font-black text-blue-600">
              {stats.pending}
            </p>
          </div>
          <div className="bg-white p-5 rounded-[24px] border-[6px] border-gray-100/50 shadow-xl shadow-gray-200/50 flex flex-col">
            <p className="text-sm text-gray-400 font-bold mb-1">已逾期</p>
            <p className="text-4xl font-black text-red-500">
              {stats.overdue}
            </p>
          </div>
          <div className="bg-white p-5 rounded-[24px] border-[6px] border-gray-100/50 shadow-xl shadow-gray-200/50 flex flex-col">
            <p className="text-sm text-gray-400 font-bold mb-1">已完成</p>
            <p className="text-4xl font-black text-green-500">
              {stats.completed}
            </p>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <h2 className="text-2xl font-black tracking-tight">
            {view === 'list' ? '期限列表' : format(currentMonth, 'yyyy年MM月')}
          </h2>
          
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {view === 'list' && (
              <div className="flex items-center gap-2 flex-1 md:flex-none min-w-[200px]">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input 
                    type="text"
                    placeholder="搜索案件、类型或备注..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-white border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
                  />
                </div>
                <select 
                  value={filterType}
                  onChange={e => setFilterType(e.target.value)}
                  className="px-3 py-2 bg-white border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
                >
                  <option value="all">全部类型</option>
                  {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            {view === 'calendar' && (
              <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-gray-100 shadow-sm mr-2">
                <button 
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  className="p-1.5 hover:bg-gray-50 rounded-lg text-gray-500 transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => setCurrentMonth(new Date())}
                  className="px-3 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  今天
                </button>
                <button 
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  className="p-1.5 hover:bg-gray-50 rounded-lg text-gray-500 transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
            <button 
              onClick={() => setIsAdding(true)}
              className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-xl shadow-blue-200"
            >
              <Plus className="w-5 h-5" />
              <span>添加期限</span>
            </button>
          </div>
        </div>

        {/* Content Area */}
        {view === 'list' ? (
          <div className="space-y-6">
            <AnimatePresence mode="popLayout">
              {filteredDeadlines.length === 0 ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-24 bg-white rounded-[32px] border-4 border-dashed border-gray-100"
                >
                  <Clock className="w-16 h-16 text-gray-200 mx-auto mb-4" />
                  <p className="text-gray-400 font-bold text-lg">
                    {searchTerm || filterType !== 'all' ? '没有找到匹配的期限' : '暂无期限提醒，点击上方按钮添加'}
                  </p>
                </motion.div>
              ) : (
                filteredDeadlines.map((deadline) => {
                  const colorClasses = getDeadlineColor(deadline);
                  return (
                    <motion.div
                      key={deadline.id}
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className={`bg-white p-6 rounded-[32px] border-[8px] border-gray-100/80 shadow-2xl shadow-gray-200/50 flex flex-col group transition-all relative ${deadline.status === 'completed' ? 'opacity-60' : ''}`}
                    >
                      {/* Action Buttons */}
                      <div className="absolute top-4 right-6 flex items-center gap-2 opacity-0 group-hover:opacity-100 z-10 transition-opacity">
                        <button 
                          onClick={() => handleEdit(deadline)}
                          className="p-2 text-gray-300 hover:text-blue-600 hover:bg-blue-50 transition-all rounded-xl"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => deleteDeadline(deadline.id)}
                          className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all rounded-xl"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-6 flex-1 min-w-[200px]">
                          <button 
                            onClick={() => toggleStatus(deadline)}
                            className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all shrink-0 ${
                              deadline.status === 'completed' 
                              ? 'bg-green-500 border-green-500 text-white' 
                              : 'border-gray-200 text-transparent hover:border-blue-400'
                            }`}
                          >
                            <CheckCircle2 className="w-5 h-5" />
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-xl font-black tracking-tight px-2 py-0.5 rounded-lg ${colorClasses} ${deadline.status === 'completed' ? 'text-gray-400 line-through' : ''}`}>
                                {deadline.type}
                              </span>
                              {deadline.status !== 'completed' && deadline.reminderDays > 0 && (
                                <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-500 rounded-lg text-[10px] font-black">
                                  <RefreshCw className="w-3 h-3 animate-pulse" />
                                  <span>提前{deadline.reminderDays}天提醒</span>
                                </div>
                              )}
                            </div>
                            <h3 className={`text-sm font-bold mt-1 ${deadline.status === 'completed' ? 'text-gray-400' : 'text-gray-500'}`}>
                              案件：{deadline.caseName}
                            </h3>
                          </div>
                        </div>

                        {/* Notes in the middle space */}
                        {deadline.notes && (
                          <div className="flex-1 mx-6 px-4 py-2 bg-gray-50/50 rounded-2xl text-xs text-gray-400 border-l-[4px] border-blue-400/20 italic font-medium hidden md:block line-clamp-2">
                            “ {deadline.notes} ”
                          </div>
                        )}

                        <div className="text-right shrink-0 ml-4">
                          {deadline.status === 'pending' || deadline.status === 'overdue' ? (
                            <div className="flex flex-col items-end">
                              <div className={`text-4xl font-black tabular-nums leading-none ${
                                deadline.status === 'overdue' ? 'text-red-500' : 
                                differenceInDays(parseISO(deadline.dueDate), startOfDay(new Date())) <= 3 ? 'text-orange-500' : 'text-blue-600'
                              }`}>
                                {Math.abs(differenceInDays(parseISO(deadline.dueDate), startOfDay(new Date())))}
                                <span className="text-lg font-black ml-1">天</span>
                              </div>
                              <div className="text-[13px] font-bold text-gray-500 mt-2">
                                截止：{deadline.dueDate}
                              </div>
                              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                                {deadline.status === 'overdue' ? '已逾期' : '剩余时间'}
                              </div>
                            </div>
                          ) : (
                            <div className="text-green-500 flex flex-col items-end">
                              <CheckCircle2 className="w-10 h-10" />
                              <span className="text-xs font-bold uppercase tracking-widest mt-1">已完成</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className="bg-white rounded-[32px] border-[8px] border-gray-100/80 shadow-2xl shadow-gray-200/50 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-100">
              {['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map(day => (
                <div key={day} className="py-4 text-center text-xs font-black text-gray-400 uppercase tracking-widest">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {calendarDays.map((day, idx) => {
                const dayDeadlines = getDeadlinesForDay(day);
                const isCurrentMonth = isSameMonth(day, currentMonth);
                const isTodayDay = isToday(day);
                
                return (
                  <div 
                    key={day.toString()} 
                    onClick={() => handleDayClick(day)}
                    className={`min-h-[120px] p-2 border-r border-b border-gray-50 transition-colors cursor-pointer group/day relative ${
                      !isCurrentMonth ? 'bg-gray-50/50 opacity-40' : 'hover:bg-blue-50/30'
                    } ${idx % 7 === 6 ? 'border-r-0' : ''}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-1">
                        <span className={`text-sm font-black w-7 h-7 flex items-center justify-center rounded-full transition-all group-hover/day:scale-110 ${
                          isTodayDay ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'text-gray-500 group-hover/day:text-blue-600'
                        }`}>
                          {format(day, 'd')}
                        </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {dayDeadlines.slice(0, 3).map(d => {
                            const colorClasses = getDeadlineColor(d);
                            return (
                              <div 
                                key={d.id} 
                                className={`h-1.5 w-1.5 rounded-full ${
                                  d.status === 'completed' ? 'bg-gray-200' : 
                                  d.type === '开庭' || d.type === '口审' ? 'bg-red-500' :
                                  differenceInDays(parseISO(d.dueDate), startOfDay(new Date())) <= 3 ? 'bg-orange-500' : 'bg-blue-500'
                                }`}
                              />
                            );
                          })}
                          {dayDeadlines.length > 3 && <div className="h-1.5 w-1.5 rounded-full bg-gray-300" />}
                        </div>
                      </div>
                      <Plus className="w-3 h-3 text-blue-400 opacity-0 group-hover/day:opacity-100 transition-opacity" />
                    </div>
                    <div className="space-y-1">
                      {dayDeadlines.slice(0, 3).map(d => (
                        <div 
                          key={d.id}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold truncate ${
                            d.status === 'completed' ? 'bg-green-100 text-green-700' :
                            d.status === 'overdue' ? 'bg-red-100 text-red-700' :
                            'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {d.type}
                        </div>
                      ))}
                      {dayDeadlines.length > 3 && (
                        <div className="text-[9px] font-bold text-gray-400 pl-1">
                          还有 {dayDeadlines.length - 3} 个期限...
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Add Modal */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdding(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-xl font-bold">添加新期限</h2>
              </div>
              <form onSubmit={handleAddDeadline} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">案件名称</label>
                  <input 
                    required
                    list="existing-cases"
                    type="text" 
                    value={newDeadline.caseName}
                    onChange={e => setNewDeadline({...newDeadline, caseName: e.target.value})}
                    placeholder="输入或选择已有案件"
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  />
                  <datalist id="existing-cases">
                    {existingCaseNames.map(name => <option key={name} value={name} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">期限类型</label>
                  <select 
                    value={newDeadline.type}
                    onChange={e => {
                      const template = TEMPLATES.find(t => t.name === e.target.value);
                      setNewDeadline({
                        ...newDeadline, 
                        type: e.target.value, 
                        value: template?.value || 0,
                        unit: template?.unit || 'days'
                      });
                    }}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {TEMPLATES.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">起算日期</label>
                    <input 
                      type="date" 
                      value={newDeadline.startDate}
                      onChange={e => setNewDeadline({...newDeadline, startDate: e.target.value})}
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      期限数值 ({newDeadline.unit === 'months' ? '月' : '天'})
                    </label>
                    <div className="flex gap-2">
                      <input 
                        type="number" 
                        value={newDeadline.value}
                        onChange={e => setNewDeadline({...newDeadline, value: parseInt(e.target.value) || 0})}
                        className="flex-1 px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <select
                        value={newDeadline.unit}
                        onChange={e => setNewDeadline({...newDeadline, unit: e.target.value})}
                        className="w-24 px-2 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <option value="days">天</option>
                        <option value="months">月</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注 (可选)</label>
                  <textarea 
                    value={newDeadline.notes}
                    onChange={e => setNewDeadline({...newDeadline, notes: e.target.value})}
                    placeholder="添加案件备注信息..."
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none h-20 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">提前提醒天数</label>
                  <div className="flex items-center gap-3">
                    <input 
                      type="range" 
                      min="0" 
                      max="15" 
                      value={newDeadline.reminderDays}
                      onChange={e => setNewDeadline({...newDeadline, reminderDays: parseInt(e.target.value)})}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                    <span className="w-12 text-center font-black text-blue-600 bg-blue-50 py-1 rounded-lg">
                      {newDeadline.reminderDays}天
                    </span>
                  </div>
                </div>
                <div className={`p-3 rounded-xl flex items-start gap-2 text-xs ${isWeekend(calculateDueDate(newDeadline.startDate, newDeadline.value, newDeadline.unit)) ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'}`}>
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p>自动计算截止日期：{format(calculateDueDate(newDeadline.startDate, newDeadline.value, newDeadline.unit), 'yyyy年MM月dd日')}</p>
                    {isWeekend(calculateDueDate(newDeadline.startDate, newDeadline.value, newDeadline.unit)) && (
                      <p className="font-bold mt-1">⚠️ 提醒：该日期为周末，请注意是否需要顺延至下周一。</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsAdding(false)}
                    className="flex-1 px-4 py-3 rounded-xl font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    取消
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-blue-600 text-white px-4 py-3 rounded-xl font-medium hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                  >
                    保存
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {isEditing && editingDeadline && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditing(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-xl font-bold">编辑期限</h2>
              </div>
              <form onSubmit={handleUpdateDeadline} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">案件名称</label>
                  <input 
                    required
                    list="existing-cases"
                    type="text" 
                    value={editingDeadline.caseName}
                    onChange={e => setEditingDeadline({...editingDeadline, caseName: e.target.value})}
                    placeholder="输入或选择已有案件"
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">期限类型</label>
                  <select 
                    value={editingDeadline.type}
                    onChange={e => setEditingDeadline({...editingDeadline, type: e.target.value})}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {TEMPLATES.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">截止日期</label>
                  <input 
                    type="date" 
                    value={editingDeadline.dueDate}
                    onChange={e => setEditingDeadline({...editingDeadline, dueDate: e.target.value})}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注 (可选)</label>
                  <textarea 
                    value={editingDeadline.notes || ''}
                    onChange={e => setEditingDeadline({...editingDeadline, notes: e.target.value})}
                    placeholder="添加案件备注信息..."
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none h-20 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">提前提醒天数</label>
                  <div className="flex items-center gap-3">
                    <input 
                      type="range" 
                      min="0" 
                      max="15" 
                      value={editingDeadline.reminderDays || 3}
                      onChange={e => setEditingDeadline({...editingDeadline, reminderDays: parseInt(e.target.value)})}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                    <span className="w-12 text-center font-black text-blue-600 bg-blue-50 py-1 rounded-lg">
                      {editingDeadline.reminderDays || 3}天
                    </span>
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="flex-1 px-4 py-3 rounded-xl font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    取消
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-blue-600 text-white px-4 py-3 rounded-xl font-medium hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                  >
                    更新
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Import Modal */}
      <AnimatePresence>
        {showImportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowImportModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h2 className="text-xl font-black text-gray-800">批量导入期限</h2>
                <button onClick={() => setShowImportModal(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <Plus className="w-6 h-6 rotate-45 text-gray-400" />
                </button>
              </div>
              <div className="p-6">
                <p className="text-sm text-gray-500 mb-4">
                  请从 Excel 中复制数据并粘贴到下方文本框。系统将自动识别格式并<span className="text-blue-600 font-bold">排除已存在的重复项</span>。
                </p>
                <textarea 
                  value={importText}
                  onChange={e => setImportText(e.target.value)}
                  placeholder="在此粘贴数据..."
                  className="w-full h-64 p-4 rounded-2xl border-2 border-gray-100 focus:border-blue-500 outline-none font-mono text-xs resize-none"
                />
                <div className="mt-6 flex gap-3">
                  <button 
                    onClick={() => setShowImportModal(false)}
                    className="flex-1 px-4 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors"
                  >
                    取消
                  </button>
                  <button 
                    onClick={handleParseAndImport}
                    disabled={isImporting || !importText.trim()}
                    className="flex-[2] bg-blue-600 text-white px-4 py-3 rounded-xl font-bold hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isImporting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                    <span>{isImporting ? '正在解析并导入...' : '开始导入'}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Day Details Modal */}
      <AnimatePresence>
        {isDayDetailsOpen && selectedDate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDayDetailsOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl relative z-10 overflow-hidden border-[12px] border-gray-100"
            >
              <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div>
                  <h2 className="text-3xl font-black tracking-tight text-blue-600">
                    {format(selectedDate, 'M月d日')}
                  </h2>
                  <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mt-1">
                    {format(selectedDate, 'EEEE', { locale: undefined })} 
                    {isToday(selectedDate) && <span className="ml-2 text-blue-500">今天</span>}
                  </p>
                </div>
                <button 
                  onClick={() => setIsDayDetailsOpen(false)}
                  className="p-3 bg-white rounded-2xl shadow-sm hover:bg-gray-100 transition-all"
                >
                  <Plus className="w-6 h-6 rotate-45 text-gray-400" />
                </button>
              </div>
              
              <div className="p-8 max-h-[60vh] overflow-y-auto">
                {getDeadlinesForDay(selectedDate).length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Clock className="w-8 h-8 text-gray-200" />
                    </div>
                    <p className="text-gray-400 font-bold">这一天没有期限安排</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {getDeadlinesForDay(selectedDate).map(d => (
                      <div 
                        key={d.id}
                        className="group bg-white p-5 rounded-3xl border-4 border-gray-50 hover:border-blue-100 transition-all flex items-center justify-between"
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-3 h-12 rounded-full ${
                            d.status === 'completed' ? 'bg-green-400' :
                            d.status === 'overdue' ? 'bg-red-400' :
                            'bg-blue-400'
                          }`} />
                          <div>
                            <h4 className="font-black text-lg leading-tight">{d.type}</h4>
                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-sm font-bold text-gray-400">案件：{d.caseName}</p>
                              {d.status !== 'completed' && d.reminderDays > 0 && (
                                <span className="text-[10px] bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-md font-black">
                                  提前{d.reminderDays}天
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => {
                              setIsDayDetailsOpen(false);
                              handleEdit(d);
                            }}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                          >
                            <Pencil className="w-5 h-5" />
                          </button>
                          <button 
                            onClick={() => deleteDeadline(d.id)}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="p-8 bg-gray-50/50 border-t border-gray-100">
                <button 
                  onClick={() => handleAddAtDate(selectedDate)}
                  className="w-full bg-blue-600 text-white py-4 rounded-3xl font-black text-lg shadow-xl shadow-blue-200 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                >
                  <Plus className="w-6 h-6" />
                  <span>在此日期添加新期限</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sync Modal */}
      <AnimatePresence>
        {showSyncModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSyncModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h2 className="text-xl font-bold">多端同步</h2>
                <button onClick={() => setShowSyncModal(false)} className="text-gray-400 hover:text-gray-600">
                  <Plus className="w-6 h-6 rotate-45" />
                </button>
              </div>
              <div className="p-6 space-y-8">
                {/* Current Device Info */}
                <div className="text-center">
                  <p className="text-sm text-gray-500 mb-2">当前设备的同步码</p>
                  <div className="flex items-center justify-center gap-3">
                    <span className="text-4xl font-black tracking-widest text-blue-600 font-mono">
                      {syncCode || '......'}
                    </span>
                    <button 
                      onClick={copySyncCode}
                      className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-4">在另一台设备上输入此代码即可同步数据</p>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-gray-100"></span></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-gray-400">或者</span></div>
                </div>

                {/* Pair Device */}
                <div>
                  <p className="text-sm text-gray-500 mb-3">输入另一台设备的同步码</p>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      maxLength={6}
                      value={inputSyncCode}
                      onChange={e => setInputSyncCode(e.target.value)}
                      placeholder="6位数字"
                      className="flex-1 px-4 py-3 rounded-xl border border-gray-200 font-mono text-center text-lg tracking-widest focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <button 
                      onClick={handlePair}
                      className="bg-blue-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-blue-700 transition-all"
                    >
                      同步
                    </button>
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-2xl space-y-3">
                  <div className="flex items-center gap-3 text-sm text-gray-600">
                    <Monitor className="w-4 h-4 text-blue-500" />
                    <span>电脑端：打开网页并安装为应用</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-gray-600">
                    <Smartphone className="w-4 h-4 text-blue-500" />
                    <span>手机端：添加到主屏幕即可使用</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
