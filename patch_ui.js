const fs = require('fs');
let r = fs.readFileSync('client/src/components/WorkflowBuilder.jsx', 'utf8');

const newComponents = `
// ==========================================
// 2a. REUSABLE UI COMPONENTS
// ==========================================

const MultiSelectDropdown = ({ label, options, selectedIds, onChange, title }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedCount = selectedIds ? selectedIds.split(',').filter(Boolean).length : 0;

  return (
    <div className="relative group hidden sm:flex items-center gap-2" ref={dropdownRef} title={title}>
      <span className="text-xs font-bold text-gray-500">{label}:</span>
      <div className="relative">
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="px-3 py-1.5 border border-gray-300 rounded text-xs bg-white text-gray-700 hover:border-blue-400 focus:outline-none focus:border-blue-500 min-w-[120px] text-left flex justify-between items-center"
        >
          <span>{selectedCount === 0 ? 'None Selected' : \`\${selectedCount} Selected\`}</span>
          <span className="ml-2 text-[10px]">▼</span>
        </button>
        
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 shadow-xl rounded-md z-50 max-h-60 overflow-y-auto">
            <div className="p-2 space-y-1">
              {options.length === 0 && <div className="text-xs text-gray-500 p-1">No workflows available</div>}
              {options.map(opt => {
                const isChecked = selectedIds ? selectedIds.split(',').includes(opt.id.toString()) : false;
                return (
                  <label key={opt.id} className="flex items-start gap-2 p-1.5 hover:bg-blue-50 rounded cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={isChecked}
                      onChange={(e) => {
                        let ids = selectedIds ? selectedIds.split(',').filter(Boolean) : [];
                        if (e.target.checked) ids.push(opt.id.toString());
                        else ids = ids.filter(id => id !== opt.id.toString());
                        onChange(ids.join(','));
                      }}
                      className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 border-gray-300"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-gray-800 leading-tight">{opt.name}</span>
                      <span className="text-[10px] text-gray-500">ID: {opt.id}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const VariableHighlighterInput = ({ value, onChange, placeholder, isTextarea, inputRef, onFocus, className }) => {
  const bgRef = useRef(null);

  const handleScroll = (e) => {
    if (bgRef.current) {
      bgRef.current.scrollTop = e.target.scrollTop;
      bgRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  const renderHighlights = (text) => {
    if (!text) return null;
    const parts = text.split(/(\\{\\{[a-zA-Z0-9_]+\\}\\\})/g);
    return parts.map((part, i) => {
      if (part.startsWith('{{') && part.endsWith('}}')) {
        return <span key={i} className="bg-blue-100 text-transparent rounded px-0.5" style={{boxShadow: 'inset 0 0 0 1px rgba(59, 130, 246, 0.2)'}}>{part}</span>;
      }
      return <span key={i} className="text-transparent">{part}</span>;
    });
  };

  const sharedStyles = \`w-full text-sm font-mono border rounded p-2 m-0 whitespace-pre-wrap break-words \${className || ''}\`;

  return (
    <div className="relative group w-full">
      <div 
        ref={bgRef}
        className={\`absolute inset-0 bg-white pointer-events-none overflow-hidden border-transparent \${sharedStyles}\`}
        style={{ zIndex: 0 }}
      >
        {renderHighlights(value || '')}
      </div>
      {isTextarea ? (
        <textarea
          ref={inputRef}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onScroll={handleScroll}
          placeholder={placeholder}
          className={\`relative bg-transparent text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none h-28 \${sharedStyles}\`}
          style={{ zIndex: 1, color: 'rgba(17, 24, 39, 0.9)', caretColor: 'black' }}
        />
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onScroll={handleScroll}
          placeholder={placeholder}
          className={\`relative bg-transparent text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 \${sharedStyles}\`}
          style={{ zIndex: 1, color: 'rgba(17, 24, 39, 0.9)', caretColor: 'black' }}
        />
      )}
    </div>
  );
};
`;

r = r.replace('// ==========================================\n// 2b. EMAIL PROPERTIES SUB-COMPONENT', newComponents + '\n// ==========================================\n// 2b. EMAIL PROPERTIES SUB-COMPONENT');
fs.writeFileSync('client/src/components/WorkflowBuilder.jsx', r);
console.log("Patched components!");
