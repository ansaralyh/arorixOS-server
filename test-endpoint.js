async function test() {
  const payload = {
    email: 'test_new_fields2@example.com',
    firstName: 'Test',
    lastName: 'User',
    businessName: 'Test Business LLC',
    phone: '(555) 999-8888',
    entityType: 'LLC',
    industry: 'Technology',
    stateOfFormation: 'California'
  };

  const res = await fetch('http://localhost:5000/api/auth/funnel-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

test();