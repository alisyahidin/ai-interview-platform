import type { ReactNode } from "react";
import type { ResourceState } from "@/types";
import LoadingState from "./LoadingState";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import NotFoundState from "./NotFoundState";
import ForbiddenState from "./ForbiddenState";
import WrongStateState from "./WrongStateState";

export interface ResourceProps<T> {
  /** The tagged union produced by a data-fetching hook (see hooks/useResource.ts). */
  resource: ResourceState<T>;
  /**
   * Business-rule guard applied only when `resource` would otherwise render
   * as "ready" (e.g. "this session is active"). Returning `false`
   * reclassifies the result as "wrong-state" instead of handing `data` to
   * `children` — this is how a per-page guard folds into the same seven-way
   * union as the transport-level states, instead of becoming a second,
   * ad hoc conditional layered on top of "ready".
   */
  isValidState?: (data: T) => boolean;
  /** Rendered for the "ready" (and valid) state. */
  children: (data: T) => ReactNode;
  /** Overrides for each non-ready state's presentation. Each defaults to the shared `<...State>` component. */
  loading?: ReactNode;
  empty?: ReactNode;
  error?: ReactNode;
  notFound?: ReactNode;
  forbidden?: ReactNode;
  wrongState?: ReactNode | ((data: T) => ReactNode);
}

/**
 * The one place a page resolves its data-fetching state. Exhaustively
 * switches over all seven `ResourceState` members so a case added to the
 * union later becomes a type error here rather than a silent blank screen.
 */
export default function Resource<T>({
  resource,
  isValidState,
  children,
  loading,
  empty,
  error,
  notFound,
  forbidden,
  wrongState,
}: ResourceProps<T>): ReactNode {
  const renderWrongState = (data: T) =>
    typeof wrongState === "function" ? wrongState(data) : (wrongState ?? <WrongStateState />);

  switch (resource.status) {
    case "loading":
      return loading ?? <LoadingState />;
    case "empty":
      return empty ?? <EmptyState />;
    case "error":
      return error ?? <ErrorState error={resource.error} />;
    case "not-found":
      return notFound ?? <NotFoundState />;
    case "forbidden":
      return forbidden ?? <ForbiddenState />;
    case "wrong-state":
      return renderWrongState(resource.data);
    case "ready":
      if (isValidState && !isValidState(resource.data)) {
        return renderWrongState(resource.data);
      }
      return children(resource.data);
    default: {
      const exhaustive: never = resource;
      return exhaustive;
    }
  }
}
