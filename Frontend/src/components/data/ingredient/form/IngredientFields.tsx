import React from 'react';

/** Disable native inputs and custom controls inside canonical ingredient fields. */
export default function IngredientFields({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      disabled={readOnly}
      ref={(element) => {
        element?.toggleAttribute('inert', readOnly);
      }}
      style={{ border: 0, padding: 0, margin: 0 }}
    >
      {children}
    </fieldset>
  );
}
