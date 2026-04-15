import { useState, useCallback } from "react";

export interface ActionState {
  busy: boolean;
  error?: string;
}

const initialAction: ActionState = { busy: false };

/**
 * Hook for managing async action state with error handling
 */
export function useAction() {
  const [action, setAction] = useState<ActionState>(initialAction);

  const runAction = useCallback(async <T>(fn: () => Promise<T>, onSuccess?: (value: T) => void) => {
    console.log(`\n[App] Executando ação...`);
    setAction({ busy: true });

    try {
      console.log(`[App] Chamando função...`);
      const result = await fn();
      console.log(`[App] Ação completada com sucesso`);
      onSuccess?.(result);
      setAction({ busy: false });
      return result;
    } catch (error: any) {
      console.error(`[App] Erro na ação:`, error);
      console.error(`[App] Mensagem:`, error.message);
      console.error(`[App] Stack:`, error.stack);
      const errorMessage = error instanceof Error ? error.message : "Erro inesperado";
      console.error(`[App] Será exibido ao usuário:`, errorMessage);
      setAction({ busy: false, error: errorMessage });
      throw error;
    }
  }, []);

  const clearError = useCallback(() => {
    setAction((prev) => ({ ...prev, error: undefined }));
  }, []);

  return { action, runAction, clearError };
}
