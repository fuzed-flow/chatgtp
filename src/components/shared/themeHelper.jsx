export const theme = {
  colors: {
    brand: {
      primary: '#0f172a',
      accent: '#f59e0b',
      surface: '#f8fafc',
    },
    status: {
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6',
    },
  },
  animations: {
    duration: {
      fast: '150ms',
      normal: '300ms',
      slow: '500ms',
    },
  }
};

export const getStatusColor = (status) => {
  const colorMap = {
    'New': 'bg-blue-100 text-blue-700 border-blue-200',
    'Contacted': 'bg-sky-100 text-sky-700 border-sky-200',
    'Booked Visit': 'bg-indigo-100 text-indigo-700 border-indigo-200',
    'Quoted': 'bg-violet-100 text-violet-700 border-violet-200',
    'Negotiation': 'bg-amber-100 text-amber-700 border-amber-200',
    'Won': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Lost': 'bg-red-100 text-red-700 border-red-200',
    'Not Started': 'bg-slate-100 text-slate-600 border-slate-200',
    'In Progress': 'bg-blue-100 text-blue-700 border-blue-200',
    'On Hold': 'bg-amber-100 text-amber-700 border-amber-200',
    'Completed': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Complete': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Cancelled': 'bg-red-100 text-red-700 border-red-200',
    'Draft': 'bg-slate-100 text-slate-600 border-slate-200',
    'Sent': 'bg-blue-100 text-blue-700 border-blue-200',
    'Approved': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Declined': 'bg-red-100 text-red-700 border-red-200',
    'Expired': 'bg-orange-100 text-orange-700 border-orange-200',
    'Paid': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Overdue': 'bg-red-100 text-red-700 border-red-200',
    'Void': 'bg-slate-100 text-slate-500 border-slate-200',
    'To Do': 'bg-slate-100 text-slate-600 border-slate-200',
    'Doing': 'bg-blue-100 text-blue-700 border-blue-200',
    'Blocked': 'bg-red-100 text-red-700 border-red-200',
    'Done': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Scheduled': 'bg-blue-100 text-blue-700 border-blue-200',
    'En Route': 'bg-amber-100 text-amber-700 border-amber-200',
    'Low': 'bg-slate-100 text-slate-600 border-slate-200',
    'Medium': 'bg-amber-100 text-amber-700 border-amber-200',
    'High': 'bg-orange-100 text-orange-700 border-orange-200',
    'Urgent': 'bg-red-100 text-red-700 border-red-200',
  };
  return colorMap[status] || 'bg-gray-100 text-gray-600 border-gray-200';
};