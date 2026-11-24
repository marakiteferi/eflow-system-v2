import { useState, useEffect, useRef } from 'react';
import api from '../../api';
import { Modal, Button } from '../ui';

/**
 * Asks for the admin verification code before a sensitive change (account types,
 * permissions, imports). Sends the code when it opens, then calls onConfirm(code).
 */
const AdminCodeDialog = ({ action, onConfirm, onClose }) => {
  const [code, setCode] = useState('');
  const [hint, setHint] = useState('Sending a code to your email…');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sent = useRef(false);

  const send = async () => {
    try {
      const res = await api.post('/admin/request-otp');
      // Without email set up (development), the server includes the code in its message
      setHint(res.data?.message || 'A code was sent to your email.');
    } catch (err) {
      setHint(err.response?.data?.message || 'Could not send a code. Try again in a moment.');
    }
  };

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    send();
  }, []);

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onConfirm(code);
    } catch (err) {
      setError(err.response?.data?.message || 'That did not work. Check the code and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Confirm it's you" subtitle={action} onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={code.length !== 6 || busy}>{busy ? 'Checking…' : 'Confirm'}</Button>
      </>}>
      <form onSubmit={submit}>
        <p className="text-sm text-gray-600 mb-4">{hint}</p>
        <input autoFocus inputMode="numeric" placeholder="000000" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          aria-label="Verification code"
          className="w-full text-center text-3xl tracking-[0.5em] font-mono p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-300 outline-none" />
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <button type="button" onClick={send} className="text-xs text-indigo-600 hover:underline mt-3">Send a new code</button>
      </form>
    </Modal>
  );
};

export default AdminCodeDialog;
