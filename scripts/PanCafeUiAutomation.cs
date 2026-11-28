using System;
using System.Runtime.InteropServices;
using System.Windows.Automation;

public static partial class PanCafeNativeSessions {
    static T UiAutomationPattern<T>(IntPtr handle, AutomationPattern pattern) where T : class {
        if (handle == IntPtr.Zero || !IsWindowVisible(handle) || !IsWindowEnabled(handle)) return null;
        uint owner;
        if (GetWindowThreadProcessId(handle, out owner) == 0) return null;
        try {
            var element = AutomationElement.FromHandle(handle);
            if (element == null || element.Current.NativeWindowHandle != handle.ToInt32() ||
                element.Current.ProcessId != (int)owner || !element.Current.IsEnabled) return null;
            object value;
            return element.TryGetCurrentPattern(pattern, out value) ? value as T : null;
        } catch (ElementNotAvailableException) {
            return null;
        } catch (COMException) {
            return null;
        } catch (ArgumentException) {
            return null;
        }
    }

    static bool TrySetUiAutomationValue(IntPtr edit, string value) {
        var pattern = UiAutomationPattern<ValuePattern>(edit, ValuePattern.Pattern);
        if (pattern == null) return false;
        try {
            if (pattern.Current.IsReadOnly) return false;
            CheckOperatorInput();
            pattern.SetValue(value);
        } catch (ElementNotAvailableException) {
            return false;
        } catch (COMException) {
            return false;
        } catch (InvalidOperationException error) {
            if (error is OperatorBusyException) throw;
            return false;
        }
        CheckOperatorInput();
        return Text(edit) == value;
    }

    static bool TryInvokeUiAutomation(IntPtr control) {
        var action = UiAutomationPattern<InvokePattern>(control, InvokePattern.Pattern);
        if (action == null) return false;
        CheckOperatorInput();
        // An invocation can succeed before the provider returns an error. Never fall back
        // to a second click after requesting the action, especially for payment confirmation.
        action.Invoke();
        return true;
    }
}
