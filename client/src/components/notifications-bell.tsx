import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell, Check, CheckCheck, X, AlertTriangle, Package, FileText, RefreshCw, Key, Brain, ShoppingCart, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: string;
  actionUrl: string | null;
  actionLabel: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  isPinned: boolean;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  metadata: any;
}

interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
}

const getNotificationIcon = (type: string) => {
  switch (type) {
    case "STOCK_WARNING_CRITICAL":
    case "STOCK_WARNING_HIGH":
    case "STOCK_WARNING_MEDIUM":
      return <AlertTriangle className="h-4 w-4" />;
    case "AUTO_PO_CREATED":
    case "PO_NEEDS_APPROVAL":
    case "SUPPLIER_ACKNOWLEDGED_PO":
      return <FileText className="h-4 w-4" />;
    case "CREDENTIAL_EXPIRING":
      return <Key className="h-4 w-4" />;
    case "AI_RECOMMENDATION":
      return <Brain className="h-4 w-4" />;
    case "SYNC_FAILED":
      return <RefreshCw className="h-4 w-4" />;
    case "RETURN_RECEIVED":
      return <Undo2 className="h-4 w-4" />;
    case "ORDER_SYNC_ISSUE":
      return <ShoppingCart className="h-4 w-4" />;
    default:
      return <Package className="h-4 w-4" />;
  }
};

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case "CRITICAL":
      return "text-red-600 bg-red-50 dark:bg-red-950";
    case "HIGH":
      return "text-orange-600 bg-orange-50 dark:bg-orange-950";
    case "MEDIUM":
      return "text-yellow-600 bg-yellow-50 dark:bg-yellow-950";
    case "LOW":
      return "text-blue-600 bg-blue-50 dark:bg-blue-950";
    default:
      return "text-muted-foreground bg-muted";
  }
};

export function NotificationsBell() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<NotificationsResponse>({
    queryKey: ["/api/notifications"],
    refetchInterval: 30000,
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("PATCH", `/api/notifications/${id}/read`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/notifications/mark-all-read", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/notifications/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      markAsReadMutation.mutate(notification.id);
    }
    if (notification.actionUrl) {
      setOpen(false);
      navigate(notification.actionUrl);
    }
  };

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];
  
  const pinnedNotifications = notifications.filter(n => n.isPinned);
  const regularNotifications = notifications.filter(n => !n.isPinned);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="button-notifications">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
              data-testid="badge-notification-count"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80" data-testid="dropdown-notifications">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="py-0">Notifications</DropdownMenuLabel>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-1 px-2 text-xs"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Bell className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No notifications</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            {pinnedNotifications.length > 0 && (
              <>
                <div className="px-2 py-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Pinned</span>
                </div>
                {pinnedNotifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onClick={() => handleNotificationClick(notification)}
                    onMarkRead={() => markAsReadMutation.mutate(notification.id)}
                    onDelete={() => deleteNotificationMutation.mutate(notification.id)}
                  />
                ))}
                {regularNotifications.length > 0 && <DropdownMenuSeparator />}
              </>
            )}
            
            {regularNotifications.length > 0 && (
              <>
                {pinnedNotifications.length > 0 && (
                  <div className="px-2 py-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Recent</span>
                  </div>
                )}
                {regularNotifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onClick={() => handleNotificationClick(notification)}
                    onMarkRead={() => markAsReadMutation.mutate(notification.id)}
                    onDelete={() => deleteNotificationMutation.mutate(notification.id)}
                  />
                ))}
              </>
            )}
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationItem({
  notification,
  onClick,
  onMarkRead,
  onDelete,
}: {
  notification: Notification;
  onClick: () => void;
  onMarkRead: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex items-start gap-3 px-2 py-2 cursor-pointer hover-elevate ${
        !notification.isRead ? "bg-accent/50" : ""
      }`}
      onClick={onClick}
      data-testid={`notification-item-${notification.id}`}
    >
      <div className={`flex-shrink-0 p-1.5 rounded ${getSeverityColor(notification.severity)}`}>
        {getNotificationIcon(notification.type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-medium truncate ${!notification.isRead ? "" : "text-muted-foreground"}`}>
            {notification.title}
          </p>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {!notification.isRead && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkRead();
                }}
                data-testid={`button-mark-read-${notification.id}`}
              >
                <Check className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              data-testid={`button-delete-notification-${notification.id}`}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">{notification.message}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}
