import ReactQuill from 'react-quill';

interface QuillEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const modules = {
  toolbar: [
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link'],
    ['clean'],
  ],
};

const formats = [
  'bold',
  'italic',
  'underline',
  'list',
  'bullet',
  'link',
];

export function QuillEditor({
  value,
  onChange,
  disabled = false,
  placeholder = 'Digite o conteúdo do email...',
}: QuillEditorProps) {
  const handleChange = (_content: string, _delta: unknown, source: string) => {
    if (source === 'user') {
      onChange(_content);
    }
  };

  return (
    <div className="quill-editor-wrapper">
      <ReactQuill
        theme="snow"
        value={value}
        onChange={handleChange}
        modules={modules}
        formats={formats}
        placeholder={placeholder}
        readOnly={disabled}
      />
      <style>{`
        .quill-editor-wrapper .ql-toolbar {
          border-top-left-radius: 0.5rem;
          border-top-right-radius: 0.5rem;
          border-color: #d1d5db;
          background-color: #f9fafb;
        }
        .quill-editor-wrapper .ql-container {
          border-bottom-left-radius: 0.5rem;
          border-bottom-right-radius: 0.5rem;
          border-color: #d1d5db;
          font-family: inherit;
          font-size: inherit;
          min-height: 200px;
        }
        .quill-editor-wrapper .ql-editor {
          min-height: 200px;
        }
        .quill-editor-wrapper .ql-editor.ql-blank::before {
          color: #9ca3af;
          font-style: normal;
        }
      `}</style>
    </div>
  );
}

export default QuillEditor;