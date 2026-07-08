import { useAuth } from '../../auth/AuthContext';
import CashCloseRecepcion from './CashCloseRecepcion';
import CashCloseAdmin from './CashCloseAdmin';

export default function CashClosePage() {
  const { staff } = useAuth();
  return staff?.role === 'ADMIN' ? <CashCloseAdmin /> : <CashCloseRecepcion />;
}
