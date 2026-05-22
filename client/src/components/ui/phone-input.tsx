import React from 'react';
import PhoneInput2 from 'react-phone-input-2';
import 'react-phone-input-2/lib/style.css';
import { cn } from '@/lib/utils';
import { CheckCircle2 } from 'lucide-react';
import { isValidPhoneNumber } from 'libphonenumber-js';

export interface PhoneInputProps {
    id?: string;
    name?: string;
    autoComplete?: string;
    value?: string;
    onChange?: (value: string) => void;
    onBlur?: () => void;
    disabled?: boolean;
    className?: string;
    placeholder?: string;
    required?: boolean;
}

const PhoneInput: React.FC<PhoneInputProps> = ({
    id,
    name,
    autoComplete,
    className,
    onChange,
    value,
    placeholder,
    disabled,
    required,
    onBlur
}) => {
    const [isValid, setIsValid] = React.useState(true);
    const [dialCode, setDialCode] = React.useState('');

    const handleChange = (val: string, data: { dialCode?: string; countryCode?: string; name?: string }) => {
        let cleanVal = val;
        if (data && data.dialCode) {
            // Case 1: Standard case where CC is present but user typed extra 0
            // Example: 880018... -> 88018...
            if (cleanVal.startsWith(data.dialCode + '0')) {
                cleanVal = data.dialCode + cleanVal.slice(data.dialCode.length + 1);
            }
            // Case 2: User deleted CC and started with 0
            // Example: 018... -> 88018...
            else if (cleanVal.startsWith('0')) {
                cleanVal = data.dialCode + cleanVal.slice(1);
            }
        }

        // Use libphonenumber-js for robust validation
        // react-phone-input-2 values usually don't include the '+', but libphonenumber-js expects it for E.164
        const fullNumber = cleanVal.startsWith('+') ? cleanVal : `+${cleanVal}`;
        const valid = isValidPhoneNumber(fullNumber);

        setIsValid(valid);

        if (data && data.dialCode) {
            setDialCode(data.dialCode);
        }

        if (onChange) {
            onChange(cleanVal);
        }
    };

    // We consider it "dirty" if it's longer than just the dial code
    const isDirty = value && value.length > (dialCode.length || 3);

    return (
        <div className={cn("phone-input-wrapper", className)}>
            <PhoneInput2
                country={'bd'}
                value={value}
                onChange={handleChange}
                onBlur={onBlur}
                disabled={disabled}
                placeholder={placeholder}
                enableSearch
                searchPlaceholder="Search countries..."
                containerClass={cn(
                    "phone-input-container",
                    !isValid && isDirty && "phone-input-invalid"
                )}
                inputClass={cn(
                    "phone-input-field",
                    !isValid && isDirty && "phone-input-field-invalid"
                )}
                buttonClass="phone-input-button"
                dropdownClass="phone-input-dropdown"
                searchClass="phone-input-search"
                inputProps={{
                    id,
                    required,
                    name: name || 'contact_number',
                    autoComplete,
                }}
            />
            {!isValid && isDirty && (
                <p className="text-xs text-red-500 mt-1 animate-in fade-in slide-in-from-top-1 duration-200">
                    Please enter a valid phone number
                </p>
            )}
            {isValid && isDirty && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1 animate-in fade-in slide-in-from-top-1 duration-200">
                    <CheckCircle2 className="w-3 h-3" /> Number is valid
                </p>
            )}
        </div>
    );
};

PhoneInput.displayName = 'PhoneInput';

export { PhoneInput };
