import { useEffect } from "react";

/**
 * The tab title follows the route. Crawlers do not run the router — per-route
 * meta for them is a build-time concern — but a person with eight tabs open is
 * still owed a title that says which day they are looking at.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
