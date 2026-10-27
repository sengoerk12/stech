import { View } from "react-native";
import { formatMoney, type Transaction } from "@stech/contracts";
import { Icon, Label, ui } from "./ui";
import { theme } from "../theme";
export function TransactionItem({ item }: { item: Transaction }) {
  const positive = item.amount > 0;
  return (
    <View
      style={[
        ui.row,
        {
          paddingVertical: 15,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 13,
          backgroundColor:
            item.kind === "bonus"
              ? theme.colors.orangeTint
              : theme.colors.elevated,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Icon
          name={
            item.kind === "adjustment" ? "sliders" : item.kind === "bonus"
              ? "gift"
              : positive
                ? "arrow-down-left"
                : "monitor"
          }
          color={
            item.kind === "bonus"
              ? theme.colors.primary
              : positive
                ? theme.colors.success
                : theme.colors.muted
          }
          size={19}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Label style={{ fontSize: 12, fontFamily: theme.font.medium }}>
          {item.title}
        </Label>
        {!!item.description && (
          <Label muted style={{ fontSize: 10 }}>{item.description}</Label>
        )}
        <Label muted style={{ fontSize: 10 }}>
          {new Intl.DateTimeFormat("tr-TR", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Istanbul",
          }).format(new Date(item.createdAt))}
        </Label>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Label
          style={{
            fontFamily: theme.font.bold,
            fontSize: 13,
            color: positive ? theme.colors.success : theme.colors.text,
          }}
        >
          {positive ? "+" : "−"}
          {formatMoney(Math.abs(item.amount))}
        </Label>
        <Label muted style={{ fontSize: 9 }}>
          Bakiye {formatMoney(item.balanceAfter)}
        </Label>
      </View>
    </View>
  );
}
