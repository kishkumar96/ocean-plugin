import { useCallback, useState } from 'react';

export const useNotification = (initialNotification = null) => {
  const [notification, setNotification] = useState(initialNotification);

  const clearNotification = useCallback(() => {
    setNotification(null);
  }, []);

  const showNotification = useCallback((nextNotification) => {
    setNotification(nextNotification);
  }, []);

  return {
    notification,
    setNotification,
    showNotification,
    clearNotification
  };
};
