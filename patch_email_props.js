const fs = require('fs');
let r = fs.readFileSync('client/src/components/WorkflowBuilder.jsx', 'utf8');

const replacement = `      <div>
        <label className="block text-xs font-bold text-gray-700 mb-1">Recipient Address</label>
        <VariableHighlighterInput
          inputRef={recipientRef}
          isTextarea={false}
          value={data.recipient || ''}
          onChange={val => onChange('recipient', val)}
          onFocus={() => { setActiveField('recipient'); setActiveRef(recipientRef); }}
          placeholder="{{submitter_email}} or user@domain.com"
        />
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-700 mb-1">Subject</label>
        <VariableHighlighterInput
          inputRef={subjectRef}
          isTextarea={false}
          value={data.subject || ''}
          onChange={val => onChange('subject', val)}
          onFocus={() => { setActiveField('subject'); setActiveRef(subjectRef); }}
          placeholder="Update on document"
        />
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-700 mb-1">Body Template</label>
        <VariableHighlighterInput
          inputRef={bodyRef}
          isTextarea={true}
          value={data.body || ''}
          onChange={val => onChange('body', val)}
          onFocus={() => { setActiveField('body'); setActiveRef(bodyRef); }}
          placeholder="Dear {{submitter_name}}, your application for '{{document_title}}' has been reviewed..."
        />
      </div>`;

r = r.replace(/      <div>\s*<label className="block text-xs font-bold text-gray-700 mb-1">Recipient Address<\/label>\s*<input[\s\S]*?<\/textarea>\s*<\/div>/, replacement);
fs.writeFileSync('client/src/components/WorkflowBuilder.jsx', r);
console.log("Patched EmailProperties!");
