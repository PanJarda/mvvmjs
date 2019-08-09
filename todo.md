# Todo notes

mam to asi spravne pojmute, ale spis to udelat asi tak ze mam tridu `Observable` nebo`ViewModelBase` a z ni pak budu dedit konkretni `AppViewModel`, kterej bude mit vlastnosti stejne jako mam ted v anonymnim objektu co pasuju do `ko.viewModel()`.

Zaroven ten `AppViewModel` bude mit metody, ktere budou slouzit pro volani z
`View`, tzn. misto matchingu v nakem poskytnutem anonymnim objektu si je bude hledat v tom viewmodelu.

view by melo mit vazbu na viewModel a viewModel vazbu na model. Ale model jsou jenom tridy ktere modeluji tu danou domenu aplikace.

VM by mel tedy mit neco jako DbContext coz ale na klientovi muze byt v podstate neco co vola Rest API pripadne IndexedDB apod.
 