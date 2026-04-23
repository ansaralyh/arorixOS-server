async function createAccount() {
  const payload = {
    email: 'ansar.horizon@example.com', // Using a new email to avoid conflicts with your existing one
    firstName: 'Ansar',
    lastName: 'Ali',
    businessName: 'horizon bee texh',
    phone: '(555) 111-2222',
    entityType: 'LLC',
    industry: 'Technology',
    stateOfFormation: 'Delaware'
  };

  const res = await fetch('http://localhost:5000/api/auth/funnel-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

createAccount();