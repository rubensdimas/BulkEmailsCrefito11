import { useState, FormEvent } from 'react';
import clsx from 'clsx';
import { QuillEditor } from '../QuillEditor';
import { isValidEmail, normalizeEmail, splitEmailInput } from '../../utils/emailValidator';

interface EmailFormProps {
  onSubmit: (subject: string, body: string) => void;
  emails: string[];
  onEmailsChange: (emails: string[]) => void;
  disabled?: boolean;
  isLoading?: boolean;
  emailCount?: number;
}

export function EmailForm({
  onSubmit,
  emails,
  onEmailsChange,
  disabled = false,
  isLoading = false,
  emailCount = 0,
}: EmailFormProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ subject?: string; body?: string }>({});

  const composeDisabled = disabled || emailCount === 0;

  const addEmails = (rawEmails: string[]): void => {
    const invalidEmails = rawEmails.filter((email) => !isValidEmail(email));
    const validEmails = rawEmails
      .filter(isValidEmail)
      .map(normalizeEmail)
      .filter((email) => !emails.includes(email));

    setEmailError(
      invalidEmails.length > 0 ? `Email inválido: ${invalidEmails[0]}` : null
    );

    if (validEmails.length > 0) {
      onEmailsChange([...emails, ...validEmails]);
    }
  };

  const commitInput = (): void => {
    const pendingEmails = splitEmailInput(emailInput);
    if (pendingEmails.length > 0) {
      addEmails(pendingEmails);
    }
    setEmailInput('');
  };

  const handleEmailInputChange = (value: string): void => {
    const parts = value.split(',');
    if (parts.length === 1) {
      setEmailInput(value);
      return;
    }

    addEmails(parts.map(normalizeEmail).filter(Boolean));
    setEmailInput('');
  };

  const removeEmail = (emailToRemove: string): void => {
    onEmailsChange(emails.filter((email) => email !== emailToRemove));
  };

  const validate = (): boolean => {
    const newErrors: { subject?: string; body?: string } = {};

    if (!subject.trim()) {
      newErrors.subject = 'Assunto é obrigatório';
    } else if (subject.length > 200) {
      newErrors.subject = 'Assunto deve ter no máximo 200 caracteres';
    }

    if (!body.trim()) {
      newErrors.body = 'Corpo do email é obrigatório';
    } else if (body.length < 10) {
      newErrors.body = 'Corpo do email deve ter pelo menos 10 caracteres';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(subject.trim(), body.trim());
    }
  };

  const isValid = subject.trim() && body.trim() && emailCount > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Recipients */}
      <div>
        <label htmlFor="recipients" className="block text-sm font-medium text-gray-700 mb-2">
          Destinatários <span className="text-red-500">*</span>
        </label>
        <div
          className={clsx(
            'flex flex-wrap items-center gap-2 min-h-12 w-full px-3 py-2 rounded-lg border transition-colors',
            'focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500',
            emailError ? 'border-red-500' : 'border-gray-300',
            isLoading ? 'bg-gray-100' : 'bg-white'
          )}
        >
          {emails.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-3 py-1 text-sm text-primary-800"
            >
              {email}
              <button
                type="button"
                aria-label={`Remover ${email}`}
                onClick={() => removeEmail(email)}
                disabled={isLoading}
                className="rounded-full text-primary-600 hover:bg-primary-200 hover:text-primary-900 disabled:opacity-50"
              >
                <span aria-hidden="true">×</span>
              </button>
            </span>
          ))}
          <input
            id="recipients"
            type="text"
            value={emailInput}
            onChange={(event) => handleEmailInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitInput();
              }
            }}
            onBlur={commitInput}
            disabled={isLoading}
            placeholder={emails.length === 0 ? 'Digite emails separados por vírgulas' : 'Adicionar email'}
            className="min-w-48 flex-1 border-0 bg-transparent px-1 py-1 text-sm text-gray-900 outline-none placeholder:text-gray-400"
          />
        </div>
        {emailError ? (
          <p className="mt-1 text-sm text-red-600" role="alert">{emailError}</p>
        ) : (
          <p className="mt-1 text-xs text-gray-500">Separe os endereços por vírgulas.</p>
        )}
      </div>

      {/* Email count indicator */}
      {emailCount > 0 && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-700 flex items-center gap-2">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            {emailCount} email(s) carregado(s) e pronto(s) para envio
          </p>
        </div>
      )}

      {/* Subject field */}
      <div>
        <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-2">
          Assunto <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          id="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={composeDisabled || isLoading}
          placeholder="Digite o assunto do email"
          maxLength={200}
          className={clsx(
            'w-full px-4 py-3 rounded-lg border transition-colors',
            'focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
            'placeholder:text-gray-400',
            errors.subject ? 'border-red-500 focus:ring-red-500' : 'border-gray-300',
            composeDisabled
              ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
              : 'bg-white text-gray-900'
          )}
        />
        {errors.subject && (
          <p className="mt-1 text-sm text-red-600">{errors.subject}</p>
        )}
        <p className="mt-1 text-xs text-gray-500">{subject.length}/200 caracteres</p>
      </div>

      {/* Body field - Quill Editor */}
      <div>
        <label htmlFor="body" className="block text-sm font-medium text-gray-700 mb-2">
          Corpo do Email <span className="text-red-500">*</span>
        </label>
        <div className={clsx(
          'rounded-lg border transition-colors',
          errors.body ? 'border-red-500' : 'border-gray-300',
          composeDisabled ? 'opacity-60' : ''
        )}>
          <QuillEditor
            value={body}
            onChange={setBody}
            disabled={composeDisabled || isLoading}
            placeholder="Digite o conteúdo do email..."
          />
        </div>
        {errors.body && (
          <p className="mt-1 text-sm text-red-600">{errors.body}</p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          {body.replace(/<[^>]*>/g, '').length} caracteres (sem tags HTML)
        </p>
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={composeDisabled || isLoading || !isValid}
        className={clsx(
          'w-full py-3 px-6 rounded-lg font-medium transition-all duration-200',
          'flex items-center justify-center gap-2',
          isValid && !composeDisabled && !isLoading
            ? 'bg-primary-600 hover:bg-primary-700 text-white shadow-md hover:shadow-lg'
            : 'bg-gray-300 text-gray-500 cursor-not-allowed',
          isLoading && 'opacity-75'
        )}
      >
        {isLoading ? (
          <>
            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Enviando...
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
            Enviar {emailCount > 0 ? `${emailCount} email(s)` : 'emails'}
          </>
        )}
      </button>

      {/* Validation hint */}
      {!isValid && emailCount === 0 && (
        <p className="text-center text-sm text-gray-500">
          Adicione pelo menos um destinatário para continuar
        </p>
      )}
    </form>
  );
}

export default EmailForm;
