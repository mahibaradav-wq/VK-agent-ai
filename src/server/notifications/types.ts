export type EmailNotification = {
  to: string;
  subject: string;
  body: string;
  url?: string;
  kind: string;
};

export type EmailNotificationAdapter = {
  name: string;
  ready: boolean;
  send: (message: EmailNotification) => Promise<void>;
};
