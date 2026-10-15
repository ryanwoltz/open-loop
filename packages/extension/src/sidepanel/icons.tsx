import type { ReactNode, SVGProps } from 'react';

const base = (children: ReactNode) =>
  function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
        {children}
      </svg>
    );
  };

export const IconLogo = base(
  <>
    <path d="M17.6 6.4a8 8 0 1 0 2.3 6.1" strokeWidth={2.4} />
    <path d="M20 4v4.5h-4.5" strokeWidth={2.4} />
  </>,
);
export const IconCursor = base(<path d="M4 4l7 17 2.5-7.5L21 11z" />);
export const IconRegion = base(<rect x="3.5" y="5" width="17" height="14" rx="2" strokeDasharray="3 3" />);
export const IconSend = base(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IconTrash = base(
  <>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </>,
);
export const IconX = base(<path d="M6 6l12 12M18 6L6 18" />);
export const IconCheck = base(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconCopy = base(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </>,
);
export const IconExternal = base(<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />);
export const IconBack = base(<path d="M15 6l-6 6 6 6" />);
export const IconSearch = base(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4-4" />
  </>,
);
export const IconTerminal = base(<path d="M4 6l6 6-6 6M12 18h8" />);
export const IconGlobe = base(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 3 2.5 14 0 17M12 3.5c-2.5 3-2.5 14 0 17" />
  </>,
);
export const IconAlert = base(
  <>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17v.5" />
  </>,
);
export const IconRefresh = base(<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />);
export const IconLayers = base(<path d="M12 4l9 5-9 5-9-5zM3 14l9 5 9-5" />);
export const IconSettings = base(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>,
);
export const IconInbox = base(
  <>
    <path d="M3 13l3-8h12l3 8v6H3z" />
    <path d="M3 13h5l1 2h6l1-2h5" />
  </>,
);
export const IconDownload = base(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />);
export const IconCloudOff = base(<path d="M3 3l18 18M8.5 8.6A5 5 0 0 0 7 18h10.5M20 16.5A4 4 0 0 0 17 9.5h-.3A6 6 0 0 0 10.4 5" />);
