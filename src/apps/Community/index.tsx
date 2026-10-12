// Customer profiles now live inside the Cases app at /support/customers.
// This keeps old /community links (bookmarks, Chat notifications) working.
import { Navigate, useLocation, useParams } from 'react-router-dom';

export default function Community() {
  const { '*': rest = '' } = useParams();
  const { search } = useLocation();
  const tail = rest.replace(/^contacts\/?/, '').replace(/\/$/, '');
  return <Navigate to={`/support/customers${tail ? `/${tail}` : ''}${search}`} replace />;
}
